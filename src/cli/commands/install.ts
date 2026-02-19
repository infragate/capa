import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import type { Capabilities, Skill } from '../../types/capabilities';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../shared/authenticated-fetch';
import { displayIntegrationPrompt, getIntegrationsUrl, parseRepoUrl } from '../utils/integration-helper';
import { getAgentConfig, agents } from 'skills/src/agents';
import type { AgentType } from 'skills/src/types';
import { VERSION } from '../../version';
import { registerMCPServer } from '../utils/mcp-client-manager';
import { parseEnvFile } from '../../shared/env-parser';
import { extractAllVariables } from '../../shared/variable-resolver';
import { resolvePlugins } from './plugin-install';

const execAsync = promisify(exec);

/**
 * Get tool IDs that are not exposed to MCP clients because no skill requires them.
 * In both expose-all and on-demand modes, only tools required by at least one skill
 * (or from a plugin) are exposed.
 */
function getUnexposedToolIds(capabilities: Capabilities): string[] {
  const requiredBySkills = new Set<string>();
  for (const skill of capabilities.skills) {
    if (skill.def?.requires) {
      for (const toolId of skill.def.requires) {
        requiredBySkills.add(toolId);
      }
    }
  }
  const pluginToolIds = new Set(
    capabilities.tools.filter((t) => t.sourcePlugin).map((t) => t.id)
  );
  const exposed = new Set([...requiredBySkills, ...pluginToolIds]);
  return capabilities.tools
    .map((t) => t.id)
    .filter((id) => !exposed.has(id));
}

/**
 * Open a URL in the user's default browser
 */
async function openBrowser(url: string): Promise<boolean> {
  try {
    const platform = process.platform;
    let command: string;
    
    if (platform === 'win32') {
      // Windows
      command = `start "" "${url}"`;
    } else if (platform === 'darwin') {
      // macOS
      command = `open "${url}"`;
    } else {
      // Linux and other Unix-like systems
      command = `xdg-open "${url}"`;
    }
    
    await execAsync(command);
    return true;
  } catch (error) {
    // Failed to open browser, but this is not critical
    return false;
  }
}

/**
 * Check if git is installed
 */
async function checkGitInstalled(): Promise<boolean> {
  try {
    await execAsync('git --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone a git repository to a temporary directory
 */
async function cloneRepository(
  platform: 'github' | 'gitlab',
  repoPath: string,
  authFetch: AuthenticatedFetch,
  version?: string,    // Tag or version to checkout (e.g., "1.2.1" or "v1.2.1")
  ref?: string         // Commit SHA to checkout (e.g., "abc123def456...")
): Promise<string> {
  const tempDir = join(tmpdir(), 'capa-skills', `${platform}-${repoPath.replace(/\//g, '-')}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  // Construct repo URL with authentication if available
  let repoUrl: string;
  const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
  
  if (platform === 'github') {
    if (hasAuth) {
      const token = authFetch.getTokenForUrl(`https://github.com/${repoPath}`);
      repoUrl = `https://oauth2:${token}@github.com/${repoPath}.git`;
    } else {
      repoUrl = `https://github.com/${repoPath}.git`;
    }
  } else { // gitlab
    if (hasAuth) {
      const token = authFetch.getTokenForUrl(`https://gitlab.com/${repoPath}`);
      repoUrl = `https://oauth2:${token}@gitlab.com/${repoPath}.git`;
    } else {
      repoUrl = `https://gitlab.com/${repoPath}.git`;
    }
  }

  try {
    if (ref) {
      // Clone full repo when checking out specific commit SHA
      // (can't use --depth 1 because we need the specific commit)
      await execAsync(`git clone "${repoUrl}" "${tempDir}"`);
      await execAsync(`git -C "${tempDir}" checkout ${ref}`);
    } else if (version) {
      // Clone with branch/tag specified
      await execAsync(`git clone --depth 1 --branch "${version}" "${repoUrl}" "${tempDir}"`);
    } else {
      // Default: clone with depth 1
      await execAsync(`git clone --depth 1 "${repoUrl}" "${tempDir}"`);
      
      // Try to get latest tag and checkout if available
      try {
        const { stdout: tags } = await execAsync(`git -C "${tempDir}" ls-remote --tags origin`);
        if (tags.trim()) {
          // Parse tags and find latest semantic version
          const tagLines = tags.trim().split('\n');
          const versionTags = tagLines
            .map(line => {
              const match = line.match(/refs\/tags\/(v?\d+\.\d+\.\d+)(?:\^\{\})?$/);
              return match ? match[1] : null;
            })
            .filter((tag): tag is string => tag !== null);
          
          if (versionTags.length > 0) {
            // Sort by semantic version and get the latest
            const latestTag = versionTags.sort((a, b) => {
              const parseVer = (v: string) => v.replace(/^v/, '').split('.').map(Number);
              const [aMaj, aMin, aPat] = parseVer(a);
              const [bMaj, bMin, bPat] = parseVer(b);
              return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat);
            })[0];
            
            await execAsync(`git -C "${tempDir}" fetch --depth 1 origin tag "${latestTag}"`);
            await execAsync(`git -C "${tempDir}" checkout "${latestTag}"`);
          }
        }
      } catch {
        // No tags or error fetching, use current HEAD (default branch)
      }
    }
    return tempDir;
  } catch (error: any) {
    // Clean up on failure
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    
    // Parse error message to provide friendly feedback
    const errorMessage = error.stderr || error.message || '';
    
    // Git not installed
    if (errorMessage.includes('git: command not found') || 
        errorMessage.includes("'git' is not recognized") ||
        errorMessage.includes('git: not found') ||
        error.code === 'ENOENT') {
      throw new Error(
        `Git is not installed on your system.\n\n` +
        `    CAPA requires Git to clone repositories and install skills.\n\n` +
        `    Please install Git:\n` +
        `    • Windows: https://git-scm.com/download/win\n` +
        `    • macOS:   brew install git  (or download from https://git-scm.com)\n` +
        `    • Linux:   sudo apt install git  (Ubuntu/Debian)\n` +
        `               sudo yum install git  (CentOS/RHEL)\n\n` +
        `    After installing Git, run: capa install`
      );
    }
    
    // Repository not found or permission denied
    if (errorMessage.includes('could not be found') || 
        errorMessage.includes('not found') || 
        errorMessage.includes("don't have permission")) {
      
      const platformName = platform === 'github' ? 'GitHub' : 'GitLab';
      const repoUrl = `https://${platform}.com/${repoPath}`;
      
      let friendlyMessage = `Repository not accessible: ${repoPath}\n\n`;
      
      if (hasAuth) {
        // User is authenticated but still can't access
        friendlyMessage += `    Possible reasons:\n`;
        friendlyMessage += `    • Repository doesn't exist at ${repoUrl}\n`;
        friendlyMessage += `    • Repository path is misspelled (check owner/repo)\n`;
        friendlyMessage += `    • Your ${platformName} token doesn't have access to this repository\n`;
        friendlyMessage += `    • Repository is in a different ${platformName} instance (use self-managed for enterprise)\n\n`;
        friendlyMessage += `    Please verify:\n`;
        friendlyMessage += `    1. The repository exists and the path is correct\n`;
        friendlyMessage += `    2. Your ${platformName} account has access to the repository\n`;
        friendlyMessage += `    3. The repository is on ${platform}.com (not a self-managed instance)`;
      } else {
        // User is not authenticated
        friendlyMessage += `    This repository appears to be private or doesn't exist.\n\n`;
        friendlyMessage += `    If this is a private repository:\n`;
        friendlyMessage += `    1. Run: capa start\n`;
        friendlyMessage += `    2. Open the integrations page in your browser\n`;
        friendlyMessage += `    3. Connect your ${platformName} account\n`;
        friendlyMessage += `    4. Run: capa install (again)\n\n`;
        friendlyMessage += `    If this is a public repository:\n`;
        friendlyMessage += `    • Verify the repository path: ${repoUrl}`;
      }
      
      throw new Error(friendlyMessage);
    }
    
    // Authentication failed
    if (errorMessage.includes('Authentication failed') || 
        errorMessage.includes('could not read Username')) {
      throw new Error(
        `Authentication failed for ${platform}.com\n\n` +
        `    Your access token may have expired or been revoked.\n` +
        `    Please reconnect your ${platform === 'github' ? 'GitHub' : 'GitLab'} account in the integrations page.`
      );
    }
    
    // Network or other error
    if (errorMessage.includes('unable to access') || 
        errorMessage.includes('Could not resolve host')) {
      throw new Error(
        `Network error: Unable to connect to ${platform}.com\n\n` +
        `    Please check your internet connection and try again.`
      );
    }
    
    // Generic git error - provide a sanitized message
    throw new Error(
      `Failed to clone repository: ${repoPath}\n\n` +
      `    Git error: ${errorMessage.split('\n').find((line: string) => line.includes('fatal:') || line.includes('error:')) || 'Unknown error'}\n` +
      `    Repository: https://${platform}.com/${repoPath}`
    );
  }
}

/**
 * Recursively find all SKILL.md files in a directory
 * Returns a map of skill name (directory name) to the SKILL.md file path
 */
function findSkillsInDirectory(dir: string): Map<string, string> {
  const skills = new Map<string, string>();
  
  function searchDir(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        
        // Skip hidden directories and common non-skill directories
        if (entry.name.startsWith('.') && entry.name !== '.agents' && entry.name !== '.cursor' && entry.name !== '.claude' && entry.name !== '.cline') {
          continue;
        }
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Check if this directory contains SKILL.md
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            // Use directory name as skill identifier
            const skillName = entry.name;
            skills.set(skillName, skillMdPath);
          }
          
          // Continue searching subdirectories
          searchDir(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  searchDir(dir);
  return skills;
}

/**
 * Read a skill and its additional files from a directory
 */
function readSkillFromDirectory(skillMdPath: string): { 
  markdown: string; 
  additionalFiles: Map<string, string> 
} {
  const markdown = readFileSync(skillMdPath, 'utf-8');
  const skillDir = dirname(skillMdPath);
  const additionalFiles = new Map<string, string>();
  
  // Read all files in the skill directory (except SKILL.md itself)
  try {
    const entries = readdirSync(skillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name !== 'SKILL.md') {
        const filePath = join(skillDir, entry.name);
        const content = readFileSync(filePath, 'utf-8');
        additionalFiles.set(entry.name, content);
      }
    }
  } catch (error) {
    // No additional files or can't read directory
  }
  
  return { markdown, additionalFiles };
}

export async function installCommand(envFile?: string | boolean): Promise<void> {
  const projectPath = process.cwd();
  
  // Detect capabilities file
  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    console.error('✗ No capabilities file found. Run "capa init" first.');
    process.exit(1);
  }
  
  console.log(`Using ${capabilitiesFile.path}`);
  
  // Parse capabilities file
  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format
  );
  
  // Generate project ID
  const projectId = generateProjectId(projectPath);
  console.log(`Project ID: ${projectId}`);
  
  // Ensure server is running
  const serverStatus = await ensureServer(VERSION);
  
  if (!serverStatus.running || !serverStatus.url) {
    console.error('✗ Failed to start server');
    process.exit(1);
  }
  
  // Initialize database
  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);
  
  // Register project
  db.upsertProject({ id: projectId, path: projectPath });

  // Resolve plugins first so merged capabilities (including plugin servers/tools) are used for env and configure
  let capabilitiesToUse = capabilities;
  if (capabilities.plugins && capabilities.plugins.length > 0) {
    console.log('\n🔌 Resolving plugins...');
    const authFetch = createAuthenticatedFetch(db);
    try {
      const { mergedCapabilities, tempDirsToCleanup } = await resolvePlugins(
        capabilities,
        projectPath,
        projectId,
        authFetch,
        db,
        (platform, repoPath, auth, version?, ref?) =>
          cloneRepository(platform, repoPath, auth, version, ref)
      );
      capabilitiesToUse = mergedCapabilities;
      for (const dir of tempDirsToCleanup) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
    } catch (err: any) {
      console.error(`✗ Plugin resolution failed: ${err.message}`);
      db.close();
      process.exit(1);
    }
  }
  
  // Handle .env file if provided
  if (envFile !== undefined) {
    // Determine the env file path
    let envFilePath: string;
    if (typeof envFile === 'boolean' && envFile) {
      // -e flag without filename, use .env
      envFilePath = resolve(projectPath, '.env');
    } else if (typeof envFile === 'string') {
      // -e with filename
      envFilePath = resolve(projectPath, envFile);
    } else {
      // This shouldn't happen, but handle it gracefully
      envFilePath = resolve(projectPath, '.env');
    }
    
    // Check if env file exists
    if (!existsSync(envFilePath)) {
      console.error(`✗ Environment file not found: ${envFilePath}`);
      console.error('\n  When using -e or --env flag, the specified .env file must exist.');
      console.error('  Please create the file or run without the flag to use the web UI.\n');
      db.close();
      process.exit(1);
    }
    
    // Parse the env file
    console.log(`\n📄 Loading variables from ${envFilePath}...`);
    let envVariables: Record<string, string>;
    try {
      envVariables = parseEnvFile(envFilePath);
      console.log(`   Found ${Object.keys(envVariables).length} variable(s) in env file`);
    } catch (error: any) {
      console.error(`✗ Failed to parse env file: ${error.message}`);
      db.close();
      process.exit(1);
    }
    
    // Extract all required variables from capabilities (merged with plugins when present)
    const requiredVars = extractAllVariables(capabilitiesToUse);
    console.log(`   Capabilities require ${requiredVars.length} variable(s): ${requiredVars.join(', ')}`);
    
    // Store the variables in the database
    for (const varName of requiredVars) {
      if (envVariables[varName]) {
        db.setVariable(projectId, varName, envVariables[varName]);
        console.log(`   ✓ Set ${varName}`);
      } else {
        console.warn(`   ⚠  Variable ${varName} not found in env file`);
      }
    }
    
    // Check if any required variables are still missing
    const missingVars: string[] = [];
    for (const varName of requiredVars) {
      const value = db.getVariable(projectId, varName);
      if (!value) {
        missingVars.push(varName);
      }
    }
    
    if (missingVars.length > 0) {
      console.error(`\n✗ Missing required variables: ${missingVars.join(', ')}`);
      console.error('  These variables are required but were not found in the env file.');
      console.error('  Please add them to your env file and try again.\n');
      db.close();
      process.exit(1);
    }
    
    console.log('   ✓ All required variables loaded from env file');
  }
  
  // Step 1: Clean up removed skills
  console.log('\n🧹 Checking for removed skills...');
  await cleanupRemovedSkills(projectPath, projectId, capabilitiesToUse.skills, capabilitiesToUse.providers, db);
  
  // Step 2: Install skills (copy to client directories) — only base skills from file; plugin skills already installed in resolvePlugins
  console.log('\n📦 Installing skills...');
  await installSkills(projectPath, projectId, capabilities.skills, capabilitiesToUse.providers, db, settings);
  
  // Step 3: Submit capabilities to server (merged, including plugin-derived)
  console.log('\n🔧 Configuring tools...');
  const response = await fetch(`${serverStatus.url}/api/projects/${projectId}/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(capabilitiesToUse),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('✗ Failed to configure project:', error);
    db.close();
    process.exit(1);
  }
  
  const result = await response.json();
  
  // Display tool validation results
  if (result.toolValidation && result.toolValidation.length > 0) {
    const successfulTools = result.toolValidation.filter((t: any) => t.success && !t.pendingAuth);
    const failedTools = result.toolValidation.filter((t: any) => !t.success && !t.pendingAuth);
    const pendingAuthTools = result.toolValidation.filter((t: any) => t.pendingAuth);
    
    if (failedTools.length > 0) {
      console.log(`\n⚠️  Tool Validation Results:`);
      console.log(`   ✓ ${successfulTools.length} of ${result.toolValidation.length} tools validated successfully`);
      console.log(`   ✗ ${failedTools.length} tool(s) failed validation:\n`);
      
      for (const failed of failedTools) {
        console.log(`   • Tool: ${failed.toolId}`);
        if (failed.serverId && failed.remoteTool) {
          console.log(`     ⮡ Upstream tool "${failed.remoteTool}" not found on server "@${failed.serverId}"`);
        }
        if (failed.error) {
          console.log(`     ⮡ ${failed.error}`);
        }
        console.log();
      }
      
      console.log(`   💡 Tip: Check your capabilities.json file and verify:`);
      console.log(`      - Tool names match exactly what the MCP server provides`);
      console.log(`      - Server IDs are correct (e.g., "@server-name")`);
      console.log(`      - MCP servers are accessible and properly configured\n`);
    } else if (pendingAuthTools.length > 0 && pendingAuthTools.length < result.toolValidation.length) {
      console.log(`\n✓ All ${successfulTools.length} non-OAuth2 tools validated successfully`);
      console.log(`  ℹ ${pendingAuthTools.length} tool(s) will be validated after OAuth2 authentication`);
    } else if (pendingAuthTools.length === 0) {
      console.log(`\n✓ All ${result.toolValidation.length} tools validated successfully`);
    }
  }

  // Warn about tools not exposed (not required by any skill)
  const unexposedToolIds = getUnexposedToolIds(capabilitiesToUse);
  if (unexposedToolIds.length > 0) {
    console.warn('\n⚠️  Tools not exposed to MCP clients:');
    console.warn('   The following tools are not required by any skill, so they will not be exposed');
    console.warn('   (in both expose-all and on-demand mode only skill-required tools are available):');
    for (const id of unexposedToolIds.sort()) {
      console.warn(`   • ${id}`);
    }
    console.warn('\n   To expose a tool, add it to the "requires" list of at least one skill in your capabilities.\n');
  }
  
  // Step 4: Register MCP server with client configurations
  const mcpUrl = `${serverStatus.url}/${projectId}/mcp`;
  console.log('\n🔗 Registering MCP server with clients...');
  await registerMCPServer(projectPath, projectId, mcpUrl, capabilitiesToUse.providers);
  
  db.close();
  
  // Step 4: Check if credential setup is needed
  if (result.needsCredentials && result.credentialsUrl) {
    const hasVariables = result.missingVariables && result.missingVariables.length > 0;
    const hasOAuth2 = result.oauth2Servers && result.oauth2Servers.length > 0;
    const needsOAuth2Connection = hasOAuth2 && result.oauth2Servers.some((s: any) => !s.isConnected);
    
    if (hasVariables && needsOAuth2Connection) {
      console.log('\n🔐 Credentials and OAuth2 connections required!');
    } else if (needsOAuth2Connection) {
      console.log('\n🔐 OAuth2 connections required!');
    } else {
      console.log('\n🔑 Credentials required!');
    }
    
    console.log(`Opening browser to configure credentials...`);
    
    if (hasVariables) {
      console.log(`  • Missing variables: ${result.missingVariables.join(', ')}`);
    }
    if (needsOAuth2Connection) {
      const disconnectedServers = result.oauth2Servers.filter((s: any) => !s.isConnected);
      console.log(`  • OAuth2 servers need connection: ${disconnectedServers.map((s: any) => s.serverId).join(', ')}`);
    }
    
    const opened = await openBrowser(result.credentialsUrl);
    
    if (opened) {
      console.log(`\n✓ Browser opened: ${result.credentialsUrl}`);
    } else {
      console.log(`\n⚠ Could not open browser automatically.`);
      console.log(`Please open this URL manually: ${result.credentialsUrl}`);
    }
    
    if (needsOAuth2Connection) {
      console.log('\nAfter configuring credentials and connecting OAuth2, the installation will be complete.');
    } else {
      console.log('\nAfter saving credentials, the installation will be complete.');
    }
  } else {
    console.log('\n✓ Installation complete!');
  }
  
  // Step 5: Display MCP endpoint
  console.log(`\n📡 MCP Endpoint: ${mcpUrl}`);
}

/**
 * Clean up skill directories for skills that have been removed from capabilities
 */
async function cleanupRemovedSkills(
  projectPath: string,
  projectId: string,
  skills: Skill[],
  clients: string[],
  db: CapaDatabase
): Promise<void> {
  // Get all managed files/directories for this project
  const managedFiles = db.getManagedFiles(projectId);
  
  if (managedFiles.length === 0) {
    console.log('  No managed skills to clean up');
    return;
  }
  
  // Build a set of skill IDs from the current capabilities
  const currentSkillIds = new Set(skills.map(s => s.id));
  
  // Track directories to remove
  const dirsToRemove: string[] = [];
  
  // Check each managed directory
  for (const managedPath of managedFiles) {
    // Extract the skill ID from the managed path
    // Managed paths are typically: /path/to/project/.agents/skills/skill-id
    const skillId = basename(managedPath);
    
    // Check if this skill is still in the capabilities file
    if (!currentSkillIds.has(skillId)) {
      // Skill has been removed, mark for cleanup
      dirsToRemove.push(managedPath);
    }
  }
  
  if (dirsToRemove.length === 0) {
    console.log('  No removed skills found');
    return;
  }
  
  // Remove the directories
  for (const dir of dirsToRemove) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        console.log(`  ✓ Removed: ${dir}`);
      } catch (error: any) {
        console.error(`  ✗ Failed to remove ${dir}: ${error.message}`);
        continue;
      }
    }
    
    // Remove from managed files tracking
    db.removeManagedFile(projectId, dir);
  }
  
  console.log(`  Cleaned up ${dirsToRemove.length} removed skill(s)`);
}

async function installSkills(
  projectPath: string,
  projectId: string,
  skills: Skill[],
  clients: string[],
  db: CapaDatabase,
  settings: any
): Promise<void> {
  const authFetch = createAuthenticatedFetch(db);
  
  // Check if any skills require git (github or gitlab type)
  const needsGit = skills.some(skill => skill.type === 'github' || skill.type === 'gitlab');
  
  if (needsGit) {
    // Check if git is installed before attempting to clone
    const gitInstalled = await checkGitInstalled();
    if (!gitInstalled) {
      console.error('\n✗ Git is not installed on your system.');
      console.error('\n  CAPA requires Git to install skills from GitHub and GitLab.');
      console.error('\n  Please install Git:');
      console.error('  • Windows: https://git-scm.com/download/win');
      console.error('  • macOS:   brew install git  (or download from https://git-scm.com)');
      console.error('  • Linux:   sudo apt install git  (Ubuntu/Debian)');
      console.error('             sudo yum install git  (CentOS/RHEL)');
      console.error('\n  After installing Git, run: capa install');
      process.exit(1);
    }
  }
  
  // Track cloned repositories to avoid cloning the same repo multiple times
  // Key: "platform:repoPath", Value: cloned directory path
  const clonedRepos = new Map<string, string>();
  
  // Track all temp directories for cleanup
  const tempDirs: string[] = [];
  
  try {
    for (const skill of skills) {
      console.log(`  Installing skill: ${skill.id}`);
    
    let skillMarkdown: string;
    let additionalFiles: Map<string, string> = new Map();
    
    if (skill.type === 'inline' && skill.def.content) {
      // Inline skill - use provided SKILL.md content
      skillMarkdown = skill.def.content;
    } else if (skill.type === 'local' && skill.def.path) {
      // Local skill - read SKILL.md from path (relative to project root or absolute)
      try {
        const skillDir = resolve(projectPath, skill.def.path);
        const skillMdPath = join(skillDir, 'SKILL.md');
        if (!existsSync(skillMdPath)) {
          throw new Error(`SKILL.md not found at ${skillMdPath}`);
        }
        const skillData = readSkillFromDirectory(skillMdPath);
        skillMarkdown = skillData.markdown;
        additionalFiles = skillData.additionalFiles;
      } catch (error: any) {
        console.error(`  ✗ Failed to install local skill ${skill.id}:`);
        console.error(`    ${error.message || error}`);
        continue;
      }
    } else if (skill.type === 'github' && skill.def.repo) {
      // GitHub skill - clone repository and search for skill
      try {
        // Parse repo string: "owner/repo@skill" or "owner/repo@skill:version" or "owner/repo@skill#sha"
        const repoWithoutVersionOrRef = skill.def.repo.split(/[:#]/)[0];
        const [repoPath, skillName] = repoWithoutVersionOrRef.split('@');
        if (!repoPath || !skillName) {
          throw new Error('Invalid GitHub repo format. Use: owner/repo@skill-name');
        }
        
        // Extract version or ref from skill.def
        const version = skill.def.version;
        const ref = skill.def.ref;
        
        // Check if we've already cloned this repo (with same version/ref)
        const repoKey = `github:${repoPath}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`;
        let repoDir = clonedRepos.get(repoKey);
        
        if (!repoDir) {
          // Clone the repository
          const versionInfo = version ? ` (version: ${version})` : ref ? ` (commit: ${ref})` : '';
          console.log(`    Cloning repository: ${repoPath}${versionInfo}...`);
          try {
            repoDir = await cloneRepository('github', repoPath, authFetch, version, ref);
            clonedRepos.set(repoKey, repoDir);
            tempDirs.push(repoDir);
          } catch (error: any) {
            if (error.message.includes('Unable to clone repository') && !authFetch.hasAuth(`https://github.com/${repoPath}`)) {
              const integrationsUrl = getIntegrationsUrl(settings.server.host, settings.server.port);
              console.error(`\n  ✗ ${error.message}`);
              displayIntegrationPrompt('GitHub', integrationsUrl);
              process.exit(1);
            }
            throw error;
          }
        }
        
        // Search for skills in the cloned repository
        const foundSkills = findSkillsInDirectory(repoDir);
        
        if (!foundSkills.has(skillName)) {
          throw new Error(
            `Skill "${skillName}" not found in repository.\n` +
            `    Repository: ${repoPath}\n` +
            `    Available skills: ${Array.from(foundSkills.keys()).join(', ') || 'none'}\n` +
            `    Tip: Check the skill name matches a directory containing SKILL.md`
          );
        }
        
        // Read the skill and its additional files
        const skillMdPath = foundSkills.get(skillName)!;
        const skillData = readSkillFromDirectory(skillMdPath);
        skillMarkdown = skillData.markdown;
        additionalFiles = skillData.additionalFiles;
        
      } catch (error: any) {
        console.error(`  ✗ Failed to install skill from GitHub:`);
        console.error(`    ${error.message || error}`);
        continue;
      }
    } else if (skill.type === 'gitlab' && skill.def.repo) {
      // GitLab skill - clone repository and search for skill
      try {
        // Parse repo string: "group/repo@skill" or "group/repo@skill:version" or "group/repo@skill#sha"
        const repoWithoutVersionOrRef = skill.def.repo.split(/[:#]/)[0];
        const [repoPath, skillName] = repoWithoutVersionOrRef.split('@');
        if (!repoPath || !skillName) {
          throw new Error('Invalid GitLab repo format. Use: owner/repo@skill-name');
        }
        
        // Extract version or ref from skill.def
        const version = skill.def.version;
        const ref = skill.def.ref;
        
        // Check if we've already cloned this repo (with same version/ref)
        const repoKey = `gitlab:${repoPath}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`;
        let repoDir = clonedRepos.get(repoKey);
        
        if (!repoDir) {
          // Clone the repository
          const versionInfo = version ? ` (version: ${version})` : ref ? ` (commit: ${ref})` : '';
          console.log(`    Cloning repository: ${repoPath}${versionInfo}...`);
          try {
            repoDir = await cloneRepository('gitlab', repoPath, authFetch, version, ref);
            clonedRepos.set(repoKey, repoDir);
            tempDirs.push(repoDir);
          } catch (error: any) {
            if (error.message.includes('Unable to clone repository') && !authFetch.hasAuth(`https://gitlab.com/${repoPath}`)) {
              const integrationsUrl = getIntegrationsUrl(settings.server.host, settings.server.port);
              console.error(`\n  ✗ ${error.message}`);
              displayIntegrationPrompt('GitLab', integrationsUrl);
              process.exit(1);
            }
            throw error;
          }
        }
        
        // Search for skills in the cloned repository
        const foundSkills = findSkillsInDirectory(repoDir);
        
        if (!foundSkills.has(skillName)) {
          throw new Error(
            `Skill "${skillName}" not found in repository.\n` +
            `    Repository: ${repoPath}\n` +
            `    Available skills: ${Array.from(foundSkills.keys()).join(', ') || 'none'}\n` +
            `    Tip: Check the skill name matches a directory containing SKILL.md`
          );
        }
        
        // Read the skill and its additional files
        const skillMdPath = foundSkills.get(skillName)!;
        const skillData = readSkillFromDirectory(skillMdPath);
        skillMarkdown = skillData.markdown;
        additionalFiles = skillData.additionalFiles;
        
      } catch (error: any) {
        console.error(`  ✗ Failed to install skill from GitLab:`);
        console.error(`    ${error.message || error}`);
        continue;
      }
    } else if (skill.type === 'remote' && skill.def.url) {
      // Remote skill - fetch SKILL.md from URL
      try {
        // Use authenticated fetch
        const response = await authFetch.fetch(skill.def.url);
        
        if (!response.ok) {
          // Check if this is a private repo error
          if (AuthenticatedFetch.isPrivateRepoError(response) && !authFetch.hasAuth(skill.def.url)) {
            const repoInfo = parseRepoUrl(skill.def.url);
            if (repoInfo && repoInfo.platform) {
              const integrationsUrl = getIntegrationsUrl(settings.server.host, settings.server.port);
              console.error(`\n  ✗ Unable to access URL (it may require authentication)`);
              displayIntegrationPrompt(repoInfo.platform === 'github' ? 'GitHub' : 'GitLab', integrationsUrl);
              process.exit(1);
            }
          }
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        skillMarkdown = await response.text();
      } catch (error: any) {
        console.error(`  ✗ Failed to fetch skill ${skill.id}:`);
        console.error(`    ${error.message || error}`);
        continue;
      }
    } else {
      // Provide detailed error message about what's wrong
      console.error(`  ✗ Invalid skill definition: ${skill.id}`);
      
      if (!skill.type || !['inline', 'remote', 'github', 'gitlab', 'local'].includes(skill.type)) {
        console.error(`    ⮡ Invalid or missing 'type'. Must be one of: 'inline', 'remote', 'github', 'gitlab', 'local'`);
        console.error(`    ⮡ Current value: ${skill.type || '(not set)'}`);
      } else if (skill.type === 'inline') {
        console.error(`    ⮡ Type is 'inline' but 'def.content' is missing`);
        console.error(`    ⮡ For inline skills, provide the SKILL.md content in 'def.content'`);
      } else if (skill.type === 'local') {
        console.error(`    ⮡ Type is 'local' but 'def.path' is missing`);
        console.error(`    ⮡ For local skills, provide the path to the directory containing SKILL.md in 'def.path'`);
      } else if (skill.type === 'github') {
        console.error(`    ⮡ Type is 'github' but 'def.repo' is missing or invalid`);
        console.error(`    ⮡ For GitHub skills, provide 'def.repo' in format: 'owner/repo@skill-name'`);
        if (skill.def.repo) {
          console.error(`    ⮡ Current value: '${skill.def.repo}'`);
        }
      } else if (skill.type === 'gitlab') {
        console.error(`    ⮡ Type is 'gitlab' but 'def.repo' is missing or invalid`);
        console.error(`    ⮡ For GitLab skills, provide 'def.repo' in format: 'owner/repo@skill-name'`);
        if (skill.def.repo) {
          console.error(`    ⮡ Current value: '${skill.def.repo}'`);
        }
      } else if (skill.type === 'remote') {
        console.error(`    ⮡ Type is 'remote' but 'def.url' is missing`);
        console.error(`    ⮡ For remote skills, provide the URL to SKILL.md in 'def.url'`);
      }
      
      console.error(`\n    Example configurations:`);
      console.error(`    - Inline:  { "id": "my-skill", "type": "inline", "def": { "content": "..." } }`);
      console.error(`    - GitHub:  { "id": "my-skill", "type": "github", "def": { "repo": "owner/repo@skill-name" } }`);
      console.error(`    - GitLab:  { "id": "my-skill", "type": "gitlab", "def": { "repo": "owner/repo@skill-name" } }`);
      console.error(`    - Remote:  { "id": "my-skill", "type": "remote", "def": { "url": "https://..." } }`);
      console.error(`    - Local:   { "id": "my-skill", "type": "local", "def": { "path": "./my-skill" } }`);
      
      continue;
    }
    
    // Install skill for each client
    for (const client of clients) {
      // Get the agent configuration from the skills package
      const agentConfig = getAgentConfig(client as AgentType);
      
      if (!agentConfig) {
        console.error(`  ✗ Unknown client: ${client}`);
        console.error(`\n  Supported clients:`);
        
        // Group agents by their display names for better readability
        const supportedAgents = Object.entries(agents)
          .map(([name, config]) => ({ name, displayName: config.displayName }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        // Display in columns for better readability
        const maxDisplayNameLength = Math.max(...supportedAgents.map(a => a.displayName.length));
        for (const agent of supportedAgents) {
          console.error(`    - ${agent.displayName.padEnd(maxDisplayNameLength)} (${agent.name})`);
        }
        
        process.exit(1);
      }
      
      // Use the correct skills directory for this agent
      const skillsBaseDir = join(projectPath, agentConfig.skillsDir);
      const skillDir = join(skillsBaseDir, skill.id);
      const skillMdPath = join(skillDir, 'SKILL.md');
      
      // Check if directory already exists
      if (existsSync(skillDir)) {
        // Check if it's managed by capa
        const managedFiles = db.getManagedFiles(projectId);
        if (!managedFiles.includes(skillDir)) {
          console.error(
            `  ✗ Directory already exists and is not managed by capa: ${skillDir}`
          );
          console.error('    Please delete it manually and run "capa install" again.');
          process.exit(1);
        }
        // Clean up existing directory
        rmSync(skillDir, { recursive: true, force: true });
      }
      
      // Create skill directory
      mkdirSync(skillDir, { recursive: true });
      
      // Write SKILL.md file
      writeFileSync(skillMdPath, skillMarkdown, 'utf-8');
      
      // Write any additional files
      for (const [filePath, content] of additionalFiles) {
        const fullPath = join(skillDir, filePath);
        const fileDir = join(fullPath, '..');
        if (!existsSync(fileDir)) {
          mkdirSync(fileDir, { recursive: true });
        }
        writeFileSync(fullPath, content, 'utf-8');
      }
      
      // Track skill directory as managed (not individual files)
      db.addManagedFile(projectId, skillDir);
      
      console.log(`    ✓ Installed to ${skillDir}`);
    }
  }
  } finally {
    // Clean up all cloned repositories
    if (tempDirs.length > 0) {
      console.log(`\n🧹 Cleaning up ${tempDirs.length} temporary ${tempDirs.length === 1 ? 'directory' : 'directories'}...`);
      for (const dir of tempDirs) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
  }
}
