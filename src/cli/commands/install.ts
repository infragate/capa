import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import type { Skill } from '../../types/capabilities';
import { getAgentConfig, agents } from 'skills/src/agents';
import type { AgentType } from 'skills/src/types';
import { VERSION } from '../../version';
import { registerMCPServer } from '../utils/mcp-client-manager';

const execAsync = promisify(exec);

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

export async function installCommand(): Promise<void> {
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
  
  // Step 1: Install skills (copy to client directories)
  console.log('\n📦 Installing skills...');
  await installSkills(projectPath, projectId, capabilities.skills, capabilities.clients, db);
  
  // Step 2: Submit capabilities to server
  console.log('\n🔧 Configuring tools...');
  const response = await fetch(`${serverStatus.url}/api/projects/${projectId}/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(capabilities),
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
  
  // Step 3: Register MCP server with client configurations
  const mcpUrl = `${serverStatus.url}/${projectId}/mcp`;
  console.log('\n🔗 Registering MCP server with clients...');
  await registerMCPServer(projectPath, projectId, mcpUrl, capabilities.clients);
  
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

async function installSkills(
  projectPath: string,
  projectId: string,
  skills: Skill[],
  clients: string[],
  db: CapaDatabase
): Promise<void> {
  for (const skill of skills) {
    console.log(`  Installing skill: ${skill.id}`);
    
    let skillMarkdown: string;
    let additionalFiles: Map<string, string> = new Map();
    
    if (skill.type === 'inline' && skill.def.content) {
      // Inline skill - use provided SKILL.md content
      skillMarkdown = skill.def.content;
    } else if (skill.type === 'github' && skill.def.repo) {
      // GitHub skill - fetch from repository (e.g., "vercel-labs/agent-skills@find-skills")
      try {
        const [repoPath, skillName] = skill.def.repo.split('@');
        if (!repoPath || !skillName) {
          throw new Error('Invalid GitHub repo format. Use: owner/repo@skill-name');
        }
        
        // Fetch SKILL.md from GitHub raw content
        const baseUrl = `https://raw.githubusercontent.com/${repoPath}/main/skills/${skillName}`;
        const skillMdUrl = `${baseUrl}/SKILL.md`;
        
        const response = await fetch(skillMdUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch SKILL.md: ${response.statusText}`);
        }
        skillMarkdown = await response.text();
        
        // TODO: Fetch additional files if needed (recursively download directory)
        // For now, we just install SKILL.md
      } catch (error) {
        console.error(`  ✗ Failed to fetch skill from GitHub:`, error);
        continue;
      }
    } else if (skill.type === 'remote' && skill.def.url) {
      // Remote skill - fetch SKILL.md from URL
      try {
        const response = await fetch(skill.def.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        skillMarkdown = await response.text();
      } catch (error) {
        console.error(`  ✗ Failed to fetch skill ${skill.id}:`, error);
        continue;
      }
    } else {
      // Provide detailed error message about what's wrong
      console.error(`  ✗ Invalid skill definition: ${skill.id}`);
      
      if (!skill.type || !['inline', 'remote', 'github'].includes(skill.type)) {
        console.error(`    ⮡ Invalid or missing 'type'. Must be one of: 'inline', 'remote', 'github'`);
        console.error(`    ⮡ Current value: ${skill.type || '(not set)'}`);
      } else if (skill.type === 'inline') {
        console.error(`    ⮡ Type is 'inline' but 'def.content' is missing`);
        console.error(`    ⮡ For inline skills, provide the SKILL.md content in 'def.content'`);
      } else if (skill.type === 'github') {
        console.error(`    ⮡ Type is 'github' but 'def.repo' is missing or invalid`);
        console.error(`    ⮡ For GitHub skills, provide 'def.repo' in format: 'owner/repo@skill-name'`);
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
      console.error(`    - Remote:  { "id": "my-skill", "type": "remote", "def": { "url": "https://..." } }`);
      
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
}
