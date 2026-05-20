import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import type { Capabilities, Skill, RequiredCommand } from '../../types/capabilities';
import { getQualifiedToolName, normalizeToolReference } from '../../types/capabilities';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../shared/authenticated-fetch';
import { displayIntegrationPrompt, getIntegrationsUrl, parseRepoUrl } from '../utils/integration-helper';
import { getProvider, getAllProviders } from '../../shared/providers';
import { parseSkillMd } from '../../shared/skill-md';
import { resolveProvidersForInstall } from '../../shared/providers/resolve';
import { VERSION } from '../../version';
import { registerMCPServer, unregisterMCPServer, registerSubAgentMCPServer, unregisterSubAgentMCPServer, purgeCursorSubAgentMCPEntries } from '../utils/mcp-client-manager';
import { parseEnvFile } from '../../shared/env-parser';
import { extractAllVariables } from '../../shared/variable-resolver';
import { resolvePlugins } from './plugin-install';
import { installAgentsFile, installSubAgentInstructions, removeSubAgentInstructions } from '../utils/agents-file';
import { installRules, pruneRules, isProviderRulesManagedPath } from '../utils/rules-installer';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isTextFile,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  BlockedPhraseError,
  reportBlockedPhraseAndExit,
} from '../../shared/skill-security';
import { getOrCreateSnapshot, type CachePlatform, type GetSnapshotResult } from '../../shared/cache';
import { LockfileBuilder, loadLockfile, saveLockfile } from '../../shared/lockfile';
import { assertSafeRepoPath, fetchRepoFile, fetchTextFile } from '../../shared/repo-file';
import { parseRepoString } from '../../shared/repo-string';
import type { LockSkillEntry } from '../../types/lockfile';

const execAsync = promisify(exec);

export interface InstallOptions {
  /** Path to a .env file (or boolean true to use ./.env). Mirrors the existing API. */
  envFile?: string | boolean;
  /** Install for a single provider (overrides capabilities file and stored selection). */
  provider?: string;
  /** When true, ignore lockfile + on-disk cache and re-resolve every remote source. */
  noCache?: boolean;
}

/** Type signature for the snapshot resolver passed into resolvePlugins. */
export type GetRepoSnapshotFn = (
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts?: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean }
) => Promise<GetSnapshotResult>

/**
 * Verify that all required CLI commands are available on the system.
 * Returns true if all checks pass, false otherwise.
 */
async function verifyRequiredCommands(commands: RequiredCommand[]): Promise<boolean> {
  console.log('\n🔍 Verifying prerequisites...');

  interface CheckResult { cli: string; description?: string; available: boolean }
  const results: CheckResult[] = [];

  for (const cmd of commands) {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? `where ${cmd.cli}` : `which ${cmd.cli}`;
    let available = false;
    try {
      await execAsync(checkCmd);
      available = true;
    } catch {
      available = false;
    }
    results.push({ cli: cmd.cli, description: cmd.description, available });
  }

  let allPassed = true;
  for (const r of results) {
    if (r.available) {
      console.log(`  ✓ ${r.cli}`);
    } else {
      allPassed = false;
      const desc = r.description ? ` — ${r.description}` : '';
      console.error(`  ✗ ${r.cli} not found${desc}`);
    }
  }

  if (!allPassed) {
    console.error('\n✗ Some required commands are missing. Please install them and try again.');
  } else {
    console.log('  All prerequisites satisfied');
  }

  return allPassed;
}

/**
 * Get tool IDs that are not exposed to MCP clients because no skill requires them.
 * In both expose-all and on-demand modes, only tools required by at least one skill
 * are exposed. Plugin tools follow the same rule — the user must declare them in
 * `tools:` and reference them from a skill's `requires` to expose them.
 */
function getUnexposedToolIds(capabilities: Capabilities): string[] {
  const requiredBySkills = new Set<string>();
  for (const skill of capabilities.skills) {
    if (skill.def?.requires) {
      for (const ref of skill.def.requires) {
        requiredBySkills.add(normalizeToolReference(ref));
      }
    }
  }
  return capabilities.tools
    .map((t) => getQualifiedToolName(t))
    .filter((id) => !requiredBySkills.has(id));
}

/**
 * Warn for each user-declared `type: plugin` skill whose id is not exposed by
 * any resolved plugin manifest. Does not fail the install — the warning lets
 * the user catch typos and stale references after a plugin upgrade.
 */
function validatePluginSkillReferences(capabilities: Capabilities): void {
  const pluginSkills = capabilities.skills.filter((s) => s.type === 'plugin');
  if (pluginSkills.length === 0) return;

  const exposedSkillIds = new Set<string>();
  for (const plugin of capabilities.resolvedPlugins ?? []) {
    for (const id of plugin.skills ?? []) {
      exposedSkillIds.add(id);
    }
  }

  for (const skill of pluginSkills) {
    if (!skill.sourcePlugin && !exposedSkillIds.has(skill.id)) {
      const available = exposedSkillIds.size > 0
        ? `Plugin skills available: ${Array.from(exposedSkillIds).sort().join(', ')}`
        : 'No plugin currently exposes any skill.';
      console.warn(
        `\n⚠ Plugin skill "${skill.id}" is declared but no configured plugin exposes a skill with that id.\n  ${available}`
      );
    }
  }
}

/**
 * Warn when a plugin server contributes tools but no user-declared tool references
 * it. With explicit tool declarations replacing auto-discovery, an unreferenced
 * plugin server is almost always a misconfiguration.
 */
function warnUnreferencedPluginServers(capabilities: Capabilities): void {
  const resolved = capabilities.resolvedPlugins ?? [];
  if (resolved.length === 0) return;

  const referencedServerIds = new Set<string>();
  for (const tool of capabilities.tools) {
    if (tool.type !== 'mcp') continue;
    const mcpDef = tool.def as { server?: string };
    if (mcpDef.server) {
      referencedServerIds.add(mcpDef.server.replace(/^@/, ''));
    }
  }

  for (const plugin of resolved) {
    const orphanServers = (plugin.serverIds ?? []).filter((id) => !referencedServerIds.has(id));
    if (orphanServers.length === 0) continue;
    console.warn(
      `\n⚠ Plugin "${plugin.id}" exposes server(s) [${orphanServers.join(', ')}] but no user-declared tool references them.\n  ` +
      `Define entries in the \`tools\` section to expose plugin capabilities, e.g.:\n` +
      `    tools:\n` +
      `      - id: my_tool\n` +
      `        type: mcp\n` +
      `        def:\n` +
      `          server: "@${orphanServers[0]}"\n` +
      `          tool: <remote_tool_name>`
    );
  }
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
 * Translate raw git/exec errors into the same friendly messages capa
 * has historically surfaced from `cloneRepository`.
 */
function explainGitError(
  error: any,
  platform: CachePlatform,
  repoPath: string,
  hasAuth: boolean
): Error {
  const errorMessage: string = error?.stderr || error?.message || '';

  if (errorMessage.includes('git: command not found') ||
      errorMessage.includes("'git' is not recognized") ||
      errorMessage.includes('git: not found') ||
      error?.code === 'ENOENT') {
    return new Error(
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

  if (errorMessage.includes('could not be found') ||
      errorMessage.includes('not found') ||
      errorMessage.includes("don't have permission")) {
    const platformName = platform === 'github' ? 'GitHub' : 'GitLab';
    const repoUrl = `https://${platform}.com/${repoPath}`;
    let friendlyMessage = `Repository not accessible: ${repoPath}\n\n`;
    if (hasAuth) {
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
      friendlyMessage += `    This repository appears to be private or doesn't exist.\n\n`;
      friendlyMessage += `    If this is a private repository:\n`;
      friendlyMessage += `    1. Run: capa start\n`;
      friendlyMessage += `    2. Open the integrations page in your browser\n`;
      friendlyMessage += `    3. Connect your ${platformName} account\n`;
      friendlyMessage += `    4. Run: capa install (again)\n\n`;
      friendlyMessage += `    If this is a public repository:\n`;
      friendlyMessage += `    • Verify the repository path: ${repoUrl}`;
    }
    return new Error(friendlyMessage);
  }

  if (errorMessage.includes('Authentication failed') ||
      errorMessage.includes('could not read Username')) {
    return new Error(
      `Authentication failed for ${platform}.com\n\n` +
      `    Your access token may have expired or been revoked.\n` +
      `    Please reconnect your ${platform === 'github' ? 'GitHub' : 'GitLab'} account in the integrations page.`
    );
  }

  if (errorMessage.includes('unable to access') ||
      errorMessage.includes('Could not resolve host')) {
    return new Error(
      `Network error: Unable to connect to ${platform}.com\n\n` +
      `    Please check your internet connection and try again.`
    );
  }

  return new Error(
    `Failed to clone repository: ${repoPath}\n\n` +
    `    Git error: ${errorMessage.split('\n').find((line: string) => line.includes('fatal:') || line.includes('error:')) || 'Unknown error'}\n` +
    `    Repository: https://${platform}.com/${repoPath}`
  );
}

/**
 * Cache-aware replacement for the legacy `cloneRepository` helper. Returns a
 * stable on-disk snapshot of the repo at the resolved commit SHA. The
 * snapshot directory is owned by the cache and must NOT be deleted by callers.
 */
async function getRepoSnapshot(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean } = {}
): Promise<GetSnapshotResult> {
  const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
  try {
    return await getOrCreateSnapshot({
      platform,
      repoPath,
      authFetch,
      version: opts.version,
      ref: opts.ref,
      pinnedSha: opts.pinnedSha,
      noCache: opts.noCache,
    });
  } catch (error: any) {
    throw explainGitError(error, platform, repoPath, hasAuth);
  }
}

/**
 * Recursively find all SKILL.md files in a directory.
 * Returns a map of skill identifier to the SKILL.md file path.
 * Each skill is indexed by its directory basename AND by the `name`
 * field from the SKILL.md frontmatter (if it differs from the dirname).
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
            skills.set(entry.name, skillMdPath);

            try {
              const content = readFileSync(skillMdPath, 'utf-8');
              const { metadata } = parseSkillMd(content);
              if (metadata.name && metadata.name !== entry.name) {
                skills.set(metadata.name, skillMdPath);
              }
            } catch {
              // Frontmatter parse failed — directory name is still indexed
            }
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
  
  function collectFiles(dir: string, relativeBase: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = relativeBase ? join(relativeBase, entry.name) : entry.name;
        if (entry.isDirectory()) {
          collectFiles(join(dir, entry.name), relativePath);
        } else if (entry.isFile()) {
          if (relativeBase === '' && entry.name === 'SKILL.md') continue;
          const content = readFileSync(join(dir, entry.name), 'utf-8');
          additionalFiles.set(relativePath, content);
        }
      }
    } catch (error) {
      // Can't read directory, skip
    }
  }

  collectFiles(skillDir, '');
  
  return { markdown, additionalFiles };
}

export async function installCommand(
  envFileOrOptions?: string | boolean | InstallOptions
): Promise<void> {
  // Backwards compatibility: callers may pass either the legacy `envFile`
  // string/boolean or the new `InstallOptions` object.
  let envFile: string | boolean | undefined;
  let flagProvider: string | undefined;
  let noCache = false;
  if (typeof envFileOrOptions === 'object' && envFileOrOptions !== null) {
    envFile = envFileOrOptions.envFile;
    flagProvider = envFileOrOptions.provider;
    noCache = !!envFileOrOptions.noCache;
  } else {
    envFile = envFileOrOptions;
  }

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
  
  // Verify required CLI commands before proceeding
  const reqCmds = capabilities.options?.requiresCommands;
  if (reqCmds && reqCmds.length > 0) {
    const passed = await verifyRequiredCommands(reqCmds);
    if (!passed) {
      process.exit(1);
    }
  }

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

  // Resolve providers (flag > capabilities file > DB > interactive prompt)
  let resolvedProviders: string[];
  try {
    resolvedProviders = await resolveProvidersForInstall({
      flagProvider,
      capabilitiesProviders: capabilities.providers,
      db,
      projectId,
    });
  } catch (err: any) {
    console.error(`✗ ${err.message}`);
    db.close();
    process.exit(1);
  }
  capabilities.providers = resolvedProviders;
  db.setProjectProviders(projectId, resolvedProviders);
  console.log(`Providers: ${resolvedProviders.join(', ')}`);

  // Load existing lockfile (if any). When --no-cache is set we ignore it for
  // resolution but still keep the existing entries as a starting point so the
  // pruning logic at the end produces a clean lockfile.
  const existingLockfile = await loadLockfile(projectPath);
  const lockBuilder = new LockfileBuilder(noCache ? null : existingLockfile);
  if (noCache) {
    console.log('\n⚠  --no-cache: ignoring existing lockfile and on-disk cache');
  } else if (existingLockfile) {
    console.log(`Using lockfile: ${capabilitiesFile.path.replace(/capabilities\.(yaml|json)$/, 'capabilities.lock')}`);
  }

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
        (platform, repoPath, auth, opts) =>
          getRepoSnapshot(platform, repoPath, auth, opts),
        capabilitiesFile.path,
        lockBuilder,
        { noCache }
      );
      capabilitiesToUse = mergedCapabilities;
      for (const dir of tempDirsToCleanup) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
    } catch (err: any) {
      if (err instanceof BlockedPhraseError) {
        db.close();
        reportBlockedPhraseAndExit(
          err.skillId,
          err.filePath,
          err.phrase,
          err.pluginName
        );
      }
      console.error(`✗ Plugin resolution failed: ${err.message}`);
      db.close();
      process.exit(1);
    }
  }

  // Validate `type: plugin` skills against the resolved plugin manifests.
  // Skills declared with `type: plugin` must match an id exposed by some plugin's
  // manifest. Mismatches surface a warning but do not fail the install.
  validatePluginSkillReferences(capabilitiesToUse);

  // Warn about plugin servers that aren't referenced by any user-declared tool.
  // With explicit tool declarations being the new contract, an "orphan" plugin
  // server is usually a sign the user forgot to expose the tools they need.
  warnUnreferencedPluginServers(capabilitiesToUse);

  // providers is guaranteed non-empty after resolveProvidersForInstall
  const providers = capabilitiesToUse.providers ?? resolvedProviders;
  capabilitiesToUse.providers = providers;

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
  await cleanupRemovedSkills(projectPath, projectId, capabilitiesToUse.skills, providers, db);
  
  // Step 2: Install skills (copy to client directories) — only base skills from file; plugin skills already installed in resolvePlugins
  console.log('\n📦 Installing skills...');
  await installSkills(
    projectPath,
    projectId,
    capabilities.skills,
    providers,
    db,
    settings,
    capabilitiesToUse,
    capabilitiesFile.path,
    lockBuilder,
    noCache
  );

  // Persist the lockfile after all remote resolutions are done. Prune entries
  // for skills/plugins that are no longer in the capabilities file.
  const skillIdsForLock = new Set(
    capabilities.skills
      .filter((s) => s.type === 'github' || s.type === 'gitlab')
      .map((s) => s.id)
  );
  const pluginIdsForLock = new Set(
    (capabilitiesToUse.resolvedPlugins ?? []).map((p) => p.id)
  );
  lockBuilder.pruneToIds(skillIdsForLock, pluginIdsForLock);
  const lockfileToSave = lockBuilder.build();
  if (lockfileToSave.skills.length === 0 && lockfileToSave.plugins.length === 0) {
    // Nothing to lock; remove any pre-existing lockfile so the project doesn't
    // carry stale entries forward.
    try {
      const lockPath = join(projectPath, 'capabilities.lock');
      if (existsSync(lockPath)) {
        rmSync(lockPath, { force: true });
      }
    } catch {}
  } else {
    try {
      await saveLockfile(projectPath, lockfileToSave);
      console.log(`  ✓ Wrote capabilities.lock (${lockfileToSave.skills.length} skill(s), ${lockfileToSave.plugins.length} plugin(s))`);
    } catch (err: any) {
      console.warn(`  ⚠ Failed to write capabilities.lock: ${err.message}`);
    }
  }
  
  // Auth + snapshot resolver shared by AGENTS.md and rule installation, so
  // both paths can clone private GitHub/GitLab repos via OAuth instead of
  // hitting raw URLs that silently return HTML login redirects.
  const repoFetchAuth = createAuthenticatedFetch(db);
  const repoFetchCtx = {
    authFetch: repoFetchAuth,
    getRepoSnapshot: (platform: CachePlatform, repoPath: string, auth: AuthenticatedFetch, opts: any) =>
      getRepoSnapshot(platform, repoPath, auth, opts),
    noCache,
  };

  // Step 3: Install agent instructions files (AGENTS.md and/or CLAUDE.md) if configured
  if (capabilities.agents) {
    console.log('\n📝 Installing agent instructions files...');
    try {
      await installAgentsFile(
        projectPath,
        capabilities.agents,
        providers,
        capabilitiesToUse.options?.security,
        capabilitiesFile.path,
        repoFetchCtx
      );
    } catch (err: any) {
      console.error(`  ✗ Failed to install agent instructions files: ${err.message}`);
      db.close();
      process.exit(1);
    }
  }

  const currentRules = capabilitiesToUse.rules ?? [];

  // Step 3.5: Prune rule artifacts that are no longer in the capabilities file.
  // Runs before install so orphans are removed first; install then writes current rules.
  if (providers.length > 0) {
    try {
      const previouslyManaged = db.getManagedFiles(projectId);
      const { removedFiles, removedMarkers } = pruneRules(
        projectPath,
        providers,
        currentRules,
        previouslyManaged
      );
      for (const f of removedFiles) {
        db.removeManagedFile(projectId, f);
      }
      if (removedFiles.length + removedMarkers.length > 0) {
        const fileWord = removedFiles.length === 1 ? 'file' : 'files';
        const blockWord = removedMarkers.length === 1 ? 'block' : 'blocks';
        console.log(
          `\n📏 Pruned ${removedFiles.length} orphan rule ${fileWord} and ` +
          `${removedMarkers.length} orphan rule marker ${blockWord}`
        );
      }
    } catch (err: any) {
      console.error(`  ⚠  Failed to prune orphan rules: ${err.message}`);
    }
  }

  // Step 3.6: Install rules across providers (gated on `rules.length > 0` — nothing to fetch otherwise)
  if (currentRules.length > 0) {
    console.log('\n📏 Installing rules...');
    try {
      const resolvedContent = new Map<string, string>();
      for (const rule of currentRules) {
        let body: string;
        if (rule.type === 'inline') {
          if (!rule.content) throw new Error(`Rule "${rule.id}" is type 'inline' but has no content.`);
          body = rule.content;
        } else if (rule.type === 'remote') {
          if (!rule.url) throw new Error(`Rule "${rule.id}" is type 'remote' but has no url.`);
          console.log(`  Fetching rule "${rule.id}" from ${rule.url}`);
          body = await fetchTextFile(rule.url, {
            authFetch: repoFetchAuth,
            sourceLabel: `rule "${rule.id}"`,
          });
        } else if (rule.type === 'github' || rule.type === 'gitlab') {
          if (!rule.def?.repo) throw new Error(`Rule "${rule.id}" is type '${rule.type}' but missing def.repo.`);
          console.log(`  Fetching rule "${rule.id}" from ${rule.type}:${rule.def.repo}`);
          const result = await fetchRepoFile(
            rule.type,
            rule.def.repo,
            repoFetchCtx.getRepoSnapshot,
            repoFetchAuth,
            { noCache }
          );
          body = result.content;
        } else {
          throw new Error(`Unknown rule type: ${(rule as any).type}`);
        }
        const security = capabilitiesToUse.options?.security;
        if (isBlockedPhrasesEnabled(security)) {
          const blockedPhrases = loadBlockedPhrases(security, capabilitiesFile.path);
          const check = checkBlockedPhrases(body, blockedPhrases);
          if (check.blocked) {
            reportBlockedPhraseAndExit(rule.id, `rule:${rule.id}`, check.phrase!);
          }
        }
        if (isCharacterSanitizationEnabled(security)) {
          const allowedChars = getAllowedCharacters(security);
          if (allowedChars !== null) {
            body = sanitizeContent(body, allowedChars);
          }
        }

        resolvedContent.set(rule.id, body);
      }

      installRules(projectPath, currentRules, providers, resolvedContent, {
        // Register every rule file we write so `pruneRules` (and `capa
        // clean`) can find it later, even after the user removes the rule
        // from the capabilities file.
        onFileWritten: (filePath) => db.addManagedFile(projectId, filePath),
      });
      console.log(`\n  ✓ ${currentRules.length} rule(s) installed`);
    } catch (err: any) {
      console.error(`  ✗ Failed to install rules: ${err.message}`);
      db.close();
      process.exit(1);
    }
  }

  // Step 4: Submit capabilities to server (merged, including plugin-derived)
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
  
  // Step 5: Register MCP server with client configurations (only when tools or subagents exist)
  const hasTools = capabilitiesToUse.tools.length > 0;
  const hasSubagents = (capabilitiesToUse.subagents ?? []).length > 0;
  const mcpUrl = `${serverStatus.url}/${projectId}/mcp`;

  if (hasTools || hasSubagents) {
    console.log('\n🔗 Registering MCP server with clients...');
    await registerMCPServer(projectPath, projectId, mcpUrl, providers);
  } else {
    console.log('\n🔗 No tools or sub-agents configured, unregistering MCP server from clients...');
    await unregisterMCPServer(projectPath, projectId, providers);
  }

  // Step 5a: Process sub-agents — register filtered endpoints + write instruction blocks
  if (capabilitiesToUse.subagents && capabilitiesToUse.subagents.length > 0) {
    console.log('\n🤖 Installing sub-agents...');

    // Clean up sub-agents that were removed since the last install
    const installedAgents = db.getSubAgents(projectId);
    const currentAgentIds = new Set(capabilitiesToUse.subagents.map((a) => a.id));
    const removedSubAgentIds = installedAgents
      .filter(({ agent_id }) => !currentAgentIds.has(agent_id))
      .map(({ agent_id }) => agent_id);

    // Cursor no longer uses per-sub-agent MCP entries — purge stale MCP keys and
    // legacy `.cursor/rules/{agentId}.mdc` scoping files for removed sub-agents only
    if (providers.some((p) => p.toLowerCase() === 'cursor')) {
      await purgeCursorSubAgentMCPEntries(projectPath, removedSubAgentIds);
    }

    for (const { agent_id } of installedAgents) {
      if (!currentAgentIds.has(agent_id)) {
        console.log(`  Removing sub-agent "${agent_id}" (no longer in capabilities)...`);
        await unregisterSubAgentMCPServer(projectPath, agent_id, providers);
        removeSubAgentInstructions(projectPath, agent_id, providers);
        db.removeSubAgent(projectId, agent_id);
      }
    }

    // Install or update each sub-agent
    for (const subAgent of capabilitiesToUse.subagents) {
      console.log(`\n  Sub-agent: ${subAgent.id}${subAgent.description ? ` — ${subAgent.description}` : ''}`);

      // Register filtered MCP endpoint
      const agentMcpUrl = `${serverStatus.url}/${projectId}/agents/${subAgent.id}/mcp`;
      await registerSubAgentMCPServer(
        projectPath,
        subAgent.id,
        agentMcpUrl,
        providers
      );

      // Write instruction block to CLAUDE.md / AGENTS.md
      installSubAgentInstructions(
        projectPath,
        subAgent,
        capabilitiesToUse,
        providers
      );

      // Track in DB for future cleanup
      db.upsertSubAgent(projectId, subAgent.id);
    }

    console.log(`\n  ✓ ${capabilitiesToUse.subagents.length} sub-agent(s) installed`);
  }

  db.close();
  
  // Step 6: Check if credential setup is needed
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
  
  // Step 7: Display MCP endpoint
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
    // Rule files share the managed-files table but are pruned in step 3.5
    if (isProviderRulesManagedPath(projectPath, managedPath, clients)) {
      continue;
    }

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
  settings: any,
  capabilities: Capabilities,
  capabilitiesFilePath: string,
  lockBuilder: LockfileBuilder,
  noCache: boolean
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

  // Per-call cache so two skills coming from the same repo+ref share one
  // resolution (saves a redundant `git fetch` even when both hit the cache).
  const resolvedRepos = new Map<string, GetSnapshotResult>();

  for (const skill of skills) {
      console.log(`  Installing skill: ${skill.id}`);
    
    let skillMarkdown: string;
    let additionalFiles: Map<string, string> = new Map();
    
    if (skill.type === 'installed') {
      // Installed skill - user installed it outside capa; capa only acknowledges for tool binding
      console.log(`    Acknowledging installed skill (no install needed)`);
      continue;
    } else if (skill.type === 'plugin') {
      // Plugin skill - the plugin already installed the SKILL.md to disk; this
      // capabilities entry binds tools to that skill via `requires`.
      if (skill.sourcePlugin) {
        console.log(`    Bound to plugin "${skill.sourcePlugin.name}" (no install needed)`);
      } else {
        console.log(`    Acknowledging plugin skill (no install needed)`);
      }
      continue;
    } else if (skill.type === 'inline' && skill.def.content) {
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
    } else if ((skill.type === 'github' || skill.type === 'gitlab') && skill.def.repo) {
      // GitHub/GitLab skill - resolve a snapshot (cache + lockfile aware)
      const platform: CachePlatform = skill.type;
      const platformLabel = platform === 'github' ? 'GitHub' : 'GitLab';
      try {
        // Parse "owner/repo@name" (recursive search) or
        // "owner/repo::path/to/skill" (exact path), with optional :version / #sha
        let parsed;
        try {
          parsed = parseRepoString(skill.def.repo);
        } catch (err: any) {
          throw new Error(
            `Invalid ${platformLabel} repo format for skill "${skill.id}": ${err.message}`
          );
        }
        const repoPath = parsed.ownerRepo;
        const skillTarget = parsed.target;

        // `version`/`ref` from the def take precedence over what's parsed off
        // the repo string, mirroring how the lockfile keys these skills.
        const version = skill.def.version ?? parsed.version;
        const ref = skill.def.ref ?? parsed.sha;

        const repoKey = `${platform}:${repoPath}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`;
        let snapshot = resolvedRepos.get(repoKey);

        if (!snapshot) {
          const lockEntry = noCache
            ? null
            : lockBuilder.findSkill(skill.id, version ?? null, ref ?? null);
          const pinnedSha = lockEntry?.resolvedRef;

          const sourceLabel = pinnedSha
            ? ` (cached @ ${pinnedSha.slice(0, 7)})`
            : version
              ? ` (version: ${version})`
              : ref
                ? ` (commit: ${ref})`
                : '';
          console.log(`    Resolving repository: ${repoPath}${sourceLabel}...`);

          try {
            snapshot = await getRepoSnapshot(platform, repoPath, authFetch, {
              version,
              ref,
              pinnedSha,
              noCache,
            });
            resolvedRepos.set(repoKey, snapshot);
          } catch (error: any) {
            if (error.message.includes('Unable to clone repository') && !authFetch.hasAuth(`https://${platform}.com/${repoPath}`)) {
              const integrationsUrl = getIntegrationsUrl(settings.server.host, settings.server.port);
              console.error(`\n  ✗ ${error.message}`);
              displayIntegrationPrompt(platformLabel, integrationsUrl);
              process.exit(1);
            }
            throw error;
          }
        }

        // Record the resolution in the lockfile builder. For both `@` and `::`
        // forms we record the right-hand side as `skillName` — consumers of the
        // lockfile only use it for human-readable display.
        const lockEntry: LockSkillEntry = {
          id: skill.id,
          source: platform,
          repo: repoPath,
          skillName: skillTarget,
          requestedVersion: version ?? null,
          requestedRef: ref ?? null,
          resolvedRef: snapshot.resolvedSha,
          resolvedVersion: snapshot.resolvedVersion ?? null,
        };
        lockBuilder.upsertSkill(lockEntry);

        // Locate the skill directory. `@` form searches the snapshot
        // recursively for a directory named `skillTarget` containing
        // SKILL.md; `::` form expects the directory at exactly that path.
        let skillMdPath: string | undefined;

        if (parsed.mode === 'exact') {
          // Reject `..` / absolute / drive-letter paths before joining so a
          // crafted capabilities entry can't read SKILL.md from outside the
          // snapshot. Shares the same guard as `fetchRepoFile`.
          let skillDir: string;
          try {
            skillDir = assertSafeRepoPath(snapshot.snapshotDir, skillTarget);
          } catch (err: any) {
            throw new Error(
              `${err.message}\n` +
              `    Repository: ${repoPath}\n` +
              `    Snapshot:   ${snapshot.resolvedSha.slice(0, 7)}`
            );
          }
          const candidate = join(skillDir, 'SKILL.md');
          if (!existsSync(candidate)) {
            throw new Error(
              `SKILL.md not found at exact path "${skillTarget}/SKILL.md".\n` +
              `    Repository: ${repoPath}\n` +
              `    Snapshot:   ${snapshot.resolvedSha.slice(0, 7)}\n` +
              `    Tip: Use "${repoPath}@${basename(skillTarget)}" to search the repo recursively for a SKILL.md.`
            );
          }
          skillMdPath = candidate;
        } else {
          const foundSkills = findSkillsInDirectory(snapshot.snapshotDir);
          if (!foundSkills.has(skillTarget)) {
            const available = Array.from(foundSkills.keys()).sort();
            throw new Error(
              `Skill "${skillTarget}" not found in repository.\n` +
              `    Repository: ${repoPath}\n` +
              `    Available skills: ${available.join(', ') || 'none'}\n` +
              `    Tip: The "@" separator matches by directory basename and SKILL.md frontmatter name. ` +
              `For an exact path, use "${repoPath}::path/to/${skillTarget}" instead.`
            );
          }
          skillMdPath = foundSkills.get(skillTarget)!;
        }

        const skillData = readSkillFromDirectory(skillMdPath);
        skillMarkdown = skillData.markdown;
        additionalFiles = skillData.additionalFiles;

      } catch (error: any) {
        console.error(`  ✗ Failed to install skill from ${platformLabel}:`);
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
      
      if (!skill.type || !['inline', 'remote', 'github', 'gitlab', 'local', 'installed', 'plugin'].includes(skill.type)) {
        console.error(`    ⮡ Invalid or missing 'type'. Must be one of: 'inline', 'remote', 'github', 'gitlab', 'local', 'installed', 'plugin'`);
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
      } else if (skill.type === 'installed') {
        console.error(`    ⮡ Type is 'installed' — skill must exist outside capa; def only needs optional description and requires`);
      } else if (skill.type === 'plugin') {
        console.error(`    ⮡ Type is 'plugin' — skill id must match a skill exposed by a configured plugin; def only needs optional description and requires`);
      }
      
      console.error(`\n    Example configurations:`);
      console.error(`    - Inline:    { "id": "my-skill", "type": "inline", "def": { "content": "..." } }`);
      console.error(`    - GitHub:    { "id": "my-skill", "type": "github", "def": { "repo": "owner/repo@skill-name" } }`);
      console.error(`    - GitLab:    { "id": "my-skill", "type": "gitlab", "def": { "repo": "owner/repo@skill-name" } }`);
      console.error(`    - Remote:    { "id": "my-skill", "type": "remote", "def": { "url": "https://..." } }`);
      console.error(`    - Local:     { "id": "my-skill", "type": "local", "def": { "path": "./my-skill" } }`);
      console.error(`    - Installed: { "id": "my-skill", "type": "installed", "def": { "description": "...", "requires": ["@server.tool"] } }`);
      console.error(`    - Plugin:    { "id": "plugin-skill", "type": "plugin", "def": { "requires": ["@server.tool"] } }`);
      
      continue;
    }

    // Security: blocked phrases and character sanitization (each can be disabled independently)
    const security = capabilities.options?.security;
    const blockPhrasesEnabled = isBlockedPhrasesEnabled(security);
    const sanitizeEnabled = isCharacterSanitizationEnabled(security);

    if (blockPhrasesEnabled) {
      let blockedPhrases: string[];
      try {
        blockedPhrases = loadBlockedPhrases(security, capabilitiesFilePath);
      } catch (err: any) {
        console.error(`  ✗ Failed to load blocked phrases for skill ${skill.id}: ${err.message}`);
        continue;
      }
      const mdCheck = checkBlockedPhrases(skillMarkdown, blockedPhrases);
      if (mdCheck.blocked) {
        reportBlockedPhraseAndExit(skill.id, 'SKILL.md', mdCheck.phrase!);
      }
      for (const [filename, content] of additionalFiles) {
        if (!isTextFile(filename)) continue;
        const check = checkBlockedPhrases(content, blockedPhrases);
        if (check.blocked) {
          reportBlockedPhraseAndExit(skill.id, filename, check.phrase!);
        }
      }
    }

    if (sanitizeEnabled) {
      const allowedCharacters = getAllowedCharacters(security);
      if (allowedCharacters !== null) {
        skillMarkdown = sanitizeContent(skillMarkdown, allowedCharacters);
        const sanitizedAdditional = new Map<string, string>();
        for (const [filename, content] of additionalFiles) {
          sanitizedAdditional.set(
            filename,
            isTextFile(filename) ? sanitizeContent(content, allowedCharacters) : content
          );
        }
        additionalFiles = sanitizedAdditional;
      }
    }

    // Install skill for each client
    for (const client of clients) {
      const providerEntry = getProvider(client);

      if (!providerEntry) {
        console.error(`  ✗ Unknown client: ${client}`);
        console.error(`\n  Supported clients:`);

        const supportedAgents = getAllProviders()
          .map((p) => ({ name: p.id, displayName: p.displayName }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

        const maxDisplayNameLength = Math.max(...supportedAgents.map(a => a.displayName.length));
        for (const agent of supportedAgents) {
          console.error(`    - ${agent.displayName.padEnd(maxDisplayNameLength)} (${agent.name})`);
        }

        process.exit(1);
      }

      const skillsBaseDir = join(projectPath, providerEntry.skillsDir);
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
