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
import { getGitProvider } from '../../shared/git-providers/registry';
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
import { copySkillTree, forEachSkillFile } from '../../shared/skill-copy';
import { parseRepoString } from '../../shared/repo-string';
import type { LockSkillEntry } from '../../types/lockfile';
import { runTasks, summary, info, warn, error, isVerbose } from '../ui';
import type { Task } from '../ui';

const execAsync = promisify(exec);

type SkillInstallOutcome = 'installed' | 'skipped' | 'failed';

interface InstallCtx {
  projectPath: string;
  projectId: string;
  capabilitiesFile: { path: string; format: 'json' | 'yaml' };
  capabilities: Capabilities;
  capabilitiesToUse: Capabilities;
  envFile?: string | boolean;
  flagProvider?: string;
  noCache: boolean;
  db: CapaDatabase;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  serverStatus: { running: boolean; url: string };
  resolvedProviders: string[];
  lockBuilder: LockfileBuilder;
  configureResult?: Record<string, unknown>;
  mcpUrl: string;
  ruleBodies?: Map<string, string>;
  resolvedRepos: Map<string, GetSnapshotResult>;
  added: number;
  failed: number;
  skipped: number;
  warnings: string[];
  errors: string[];
}

const VALID_REQUIRES_COMMAND_CLI = /^[a-zA-Z0-9_.+-]+$/;

function assertValidRequiresCommandCli(cli: string): void {
  if (!VALID_REQUIRES_COMMAND_CLI.test(cli)) {
    throw new Error(
      `Invalid command name in capabilities requiresCommands: ${cli}. Only [a-zA-Z0-9_.+-] characters are allowed.`
    );
  }
}

function gitOAuthHelpText(): string {
  return (
    'CAPA requires Git to clone repositories and install skills.\n\n' +
    'Please install Git:\n' +
    '• Windows: https://git-scm.com/download/win\n' +
    '• macOS:   brew install git  (or download from https://git-scm.com)\n' +
    '• Linux:   sudo apt install git  (Ubuntu/Debian)\n' +
    '           sudo yum install git  (CentOS/RHEL)\n\n' +
    'After installing Git, run: capa install'
  );
}

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

async function checkRequiredCommand(cmd: RequiredCommand): Promise<void> {
  assertValidRequiresCommandCli(cmd.cli);
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? `where ${cmd.cli}` : `which ${cmd.cli}`;
  try {
    await execAsync(checkCmd);
  } catch {
    const desc = cmd.description ? ` — ${cmd.description}` : '';
    throw new Error(`${cmd.cli} not found${desc}`);
  }
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
function collectPluginSkillWarnings(capabilities: Capabilities): string[] {
  const pluginSkills = capabilities.skills.filter((s) => s.type === 'plugin');
  if (pluginSkills.length === 0) return [];

  const exposedSkillIds = new Set<string>();
  for (const plugin of capabilities.resolvedPlugins ?? []) {
    for (const id of plugin.skills ?? []) {
      exposedSkillIds.add(id);
    }
  }

  const warnings: string[] = [];
  for (const skill of pluginSkills) {
    if (!skill.sourcePlugin && !exposedSkillIds.has(skill.id)) {
      const available = exposedSkillIds.size > 0
        ? `Plugin skills available: ${Array.from(exposedSkillIds).sort().join(', ')}`
        : 'No plugin currently exposes any skill.';
      warnings.push(
        `Plugin skill "${skill.id}" is declared but no configured plugin exposes a skill with that id. ${available}`,
      );
    }
  }
  return warnings;
}

/**
 * Warn when a plugin server contributes tools but no user-declared tool references
 * it. With explicit tool declarations replacing auto-discovery, an unreferenced
 * plugin server is almost always a misconfiguration.
 */
function collectUnreferencedPluginServerWarnings(capabilities: Capabilities): string[] {
  const resolved = capabilities.resolvedPlugins ?? [];
  if (resolved.length === 0) return [];

  const referencedServerIds = new Set<string>();
  for (const tool of capabilities.tools) {
    if (tool.type !== 'mcp') continue;
    const mcpDef = tool.def as { server?: string };
    if (mcpDef.server) {
      referencedServerIds.add(mcpDef.server.replace(/^@/, ''));
    }
  }

  const warnings: string[] = [];
  for (const plugin of resolved) {
    const orphanServers = (plugin.serverIds ?? []).filter((id) => !referencedServerIds.has(id));
    if (orphanServers.length === 0) continue;
    warnings.push(
      `Plugin "${plugin.id}" exposes server(s) [${orphanServers.join(', ')}] but no user-declared tool references them. ` +
        `Add entries in the \`tools\` section to expose them, e.g.: tools: - id: my_tool, type: mcp, def: { server: "@${orphanServers[0]}", tool: <remote_tool_name> }`,
    );
  }
  return warnings;
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
      gitOAuthHelpText().split('\n').map((line) => (line ? `    ${line}` : '')).join('\n')
    );
  }

  if (errorMessage.includes('could not be found') ||
      errorMessage.includes('not found') ||
      errorMessage.includes("don't have permission")) {
    const platformName = getGitProvider(platform)?.displayName ?? platform;
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
      `    Please reconnect your ${getGitProvider(platform)?.displayName ?? platform} account in the integrations page.`
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
  const providerHiddenDirs = new Set(
    getAllProviders()
      .map((p) => dirname(p.skillsDir) || p.skillsDir)
      .filter((d) => d.startsWith('.'))
  );

  function searchDir(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        
        // Skip hidden directories and common non-skill directories
        if (entry.name.startsWith('.') && !providerHiddenDirs.has(entry.name)) {
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

  try {
    forEachSkillFile(skillDir, ({ relPath, srcPath }) => {
      const normalized = relPath.replace(/\\/g, '/');
      if (normalized === 'SKILL.md') return;
      try {
        additionalFiles.set(normalized, readFileSync(srcPath, 'utf-8'));
      } catch {
        // Can't read file, skip
      }
    });
  } catch {
    // Can't read directory, skip
  }

  return { markdown, additionalFiles };
}

function buildInstallTasks(reqCmds?: RequiredCommand[]): Task<InstallCtx>[] {
  const tasks: Task<InstallCtx>[] = [];

  if (reqCmds && reqCmds.length > 0) {
    tasks.push({
      title: 'Verifying prerequisites',
      task: (_ctx, task) =>
        task.newListr(
          reqCmds.map((cmd) => ({
            title: cmd.description ? `${cmd.cli} — ${cmd.description}` : cmd.cli,
            task: () => checkRequiredCommand(cmd),
          })),
          { concurrent: false },
        ),
    });
  }

  tasks.push(
    {
      title: 'Resolving plugins',
      enabled: (ctx) => !!(ctx.capabilities.plugins && ctx.capabilities.plugins.length > 0),
      task: async (ctx) => {
        const authFetch = createAuthenticatedFetch(ctx.db);
        try {
          const { mergedCapabilities, tempDirsToCleanup } = await resolvePlugins(
            ctx.capabilities,
            ctx.projectPath,
            ctx.projectId,
            authFetch,
            ctx.db,
            (platform, repoPath, auth, opts) =>
              getRepoSnapshot(platform, repoPath, auth, opts),
            ctx.capabilitiesFile.path,
            ctx.lockBuilder,
            { noCache: ctx.noCache },
          );
          ctx.capabilitiesToUse = mergedCapabilities;
          for (const dir of tempDirsToCleanup) {
            try {
              rmSync(dir, { recursive: true, force: true });
            } catch {}
          }
        } catch (err: any) {
          if (err instanceof BlockedPhraseError) {
            reportBlockedPhraseAndExit(
              err.skillId,
              err.filePath,
              err.phrase,
              err.pluginName,
            );
          }
          throw new Error(`Plugin resolution failed: ${err.message}`);
        }
        ctx.warnings.push(...collectPluginSkillWarnings(ctx.capabilitiesToUse));
        ctx.warnings.push(...collectUnreferencedPluginServerWarnings(ctx.capabilitiesToUse));
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        ctx.capabilitiesToUse.providers = providers;
      },
    },
    {
      title: 'Validating plugin configuration',
      enabled: (ctx) =>
        !ctx.capabilities.plugins?.length &&
        ((ctx.capabilitiesToUse.resolvedPlugins?.length ?? 0) > 0 ||
          ctx.capabilitiesToUse.skills.some((s) => s.type === 'plugin')),
      task: async (ctx) => {
        ctx.warnings.push(...collectPluginSkillWarnings(ctx.capabilitiesToUse));
        ctx.warnings.push(...collectUnreferencedPluginServerWarnings(ctx.capabilitiesToUse));
      },
    },
    {
      title: 'Loading environment variables',
      enabled: (ctx) => ctx.envFile !== undefined,
      task: async (ctx) => {
        let envFilePath: string;
        if (typeof ctx.envFile === 'boolean' && ctx.envFile) {
          envFilePath = resolve(ctx.projectPath, '.env');
        } else if (typeof ctx.envFile === 'string') {
          envFilePath = resolve(ctx.projectPath, ctx.envFile);
        } else {
          envFilePath = resolve(ctx.projectPath, '.env');
        }

        if (!existsSync(envFilePath)) {
          throw new Error(
            `Environment file not found: ${envFilePath}\n\n` +
              '  When using -e or --env flag, the specified .env file must exist.\n' +
              '  Please create the file or run without the flag to use the web UI.\n',
          );
        }

        let envVariables: Record<string, string>;
        try {
          envVariables = parseEnvFile(envFilePath);
        } catch (error: any) {
          throw new Error(`Failed to parse env file: ${error.message}`);
        }

        const requiredVars = extractAllVariables(ctx.capabilitiesToUse);
        for (const varName of requiredVars) {
          if (envVariables[varName]) {
            ctx.db.setVariable(ctx.projectId, varName, envVariables[varName]);
          } else {
            ctx.warnings.push(`Variable ${varName} not found in env file`);
          }
        }

        const missingVars: string[] = [];
        for (const varName of requiredVars) {
          const value = ctx.db.getVariable(ctx.projectId, varName);
          if (!value) {
            missingVars.push(varName);
          }
        }

        if (missingVars.length > 0) {
          throw new Error(
            `Missing required variables: ${missingVars.join(', ')}\n` +
              '  These variables are required but were not found in the env file.\n' +
              '  Please add them to your env file and try again.\n',
          );
        }
      },
    },
    {
      title: 'Checking for removed skills',
      task: async (ctx) => {
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        const stats = await cleanupRemovedSkills(
          ctx.projectPath,
          ctx.projectId,
          ctx.capabilitiesToUse.skills,
          providers,
          ctx.db,
        );
        ctx.skipped += stats.skipped;
        ctx.added += stats.removed;
      },
    },
    {
      title: 'Installing skills',
      task: async (ctx, task) => {
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        const needsGit = ctx.capabilities.skills.some(
          (skill) => skill.type === 'github' || skill.type === 'gitlab',
        );
        if (needsGit) {
          const gitInstalled = await checkGitInstalled();
          if (!gitInstalled) {
            const lines = gitOAuthHelpText().split('\n');
            throw new Error(
              'Git is not installed on your system.\n\n' + lines.map((line) => (line ? `  ${line}` : '')).join('\n'),
            );
          }
        }
        await task.newListr(
          ctx.capabilities.skills.map((skill) => ({
            title: skill.id,
            task: async (_ctx, subtask) => {
              let outcome: 'installed' | 'failed' | 'skipped' | undefined;
              try {
                outcome = await installOneSkill(
                  skill,
                  ctx.projectPath,
                  ctx.projectId,
                  providers,
                  ctx.db,
                  ctx.settings,
                  ctx.capabilitiesToUse,
                  ctx.capabilitiesFile.path,
                  ctx.lockBuilder,
                  ctx.noCache,
                  ctx.resolvedRepos,
                );
              } catch (err: unknown) {
                ctx.failed++;
                const message = err instanceof Error ? err.message : String(err);
                subtask.title = `${skill.id} — ${message.split('\n')[0]}`;
                throw err;
              }
              if (outcome === 'installed') ctx.added++;
              else if (outcome === 'skipped') ctx.skipped++;
              else {
                ctx.failed++;
                throw new Error(`${skill.id} failed (see logs above)`);
              }
            },
          })),
          { concurrent: false, exitOnError: false, rendererOptions: { collapseSubtasks: false } },
        );
      },
    },
    {
      title: 'Writing lockfile',
      task: async (ctx) => {
        const skillIdsForLock = new Set(
          ctx.capabilities.skills
            .filter((s) => s.type === 'github' || s.type === 'gitlab')
            .map((s) => s.id),
        );
        const pluginIdsForLock = new Set(
          (ctx.capabilitiesToUse.resolvedPlugins ?? []).map((p) => p.id),
        );
        ctx.lockBuilder.pruneToIds(skillIdsForLock, pluginIdsForLock);
        const lockfileToSave = ctx.lockBuilder.build();
        if (lockfileToSave.skills.length === 0 && lockfileToSave.plugins.length === 0) {
          try {
            const lockPath = join(ctx.projectPath, 'capabilities.lock');
            if (existsSync(lockPath)) {
              rmSync(lockPath, { force: true });
            }
          } catch {}
        } else {
          try {
            await saveLockfile(ctx.projectPath, lockfileToSave);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.warnings.push(`Failed to write capabilities.lock: ${message}`);
          }
        }
      },
    },
    {
      title: 'Installing agent instructions',
      enabled: (ctx) => !!ctx.capabilities.agents,
      task: async (ctx) => {
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        const repoFetchAuth = createAuthenticatedFetch(ctx.db);
        const repoFetchCtx = {
          authFetch: repoFetchAuth,
          getRepoSnapshot: (platform: CachePlatform, repoPath: string, auth: AuthenticatedFetch, opts: any) =>
            getRepoSnapshot(platform, repoPath, auth, opts),
          noCache: ctx.noCache,
        };
        try {
          await installAgentsFile(
            ctx.projectPath,
            ctx.capabilities.agents!,
            providers,
            ctx.capabilitiesToUse.options?.security,
            ctx.capabilitiesFile.path,
            repoFetchCtx,
          );
        } catch (err: any) {
          throw new Error(`Failed to install agent instructions files: ${err.message}`);
        }
      },
    },
    {
      title: 'Pruning orphan rules',
      enabled: (ctx) => (ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders).length > 0,
      task: async (ctx) => {
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        const currentRules = ctx.capabilitiesToUse.rules ?? [];
        try {
          const previouslyManaged = ctx.db.getManagedFiles(ctx.projectId);
          const { removedFiles, removedMarkers } = pruneRules(
            ctx.projectPath,
            providers,
            currentRules,
            previouslyManaged,
          );
          for (const f of removedFiles) {
            ctx.db.removeManagedFile(ctx.projectId, f);
          }
          if (removedFiles.length + removedMarkers.length > 0) {
            ctx.added += removedFiles.length + removedMarkers.length;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.warnings.push(`Failed to prune orphan rules: ${message}`);
        }
      },
    },
    {
      title: 'Installing rules',
      enabled: (ctx) => (ctx.capabilitiesToUse.rules ?? []).length > 0,
      task: async (ctx, task) => {
        const currentRules = ctx.capabilitiesToUse.rules ?? [];
        const repoFetchAuth = createAuthenticatedFetch(ctx.db);
        const repoFetchCtx = {
          authFetch: repoFetchAuth,
          getRepoSnapshot: (platform: CachePlatform, repoPath: string, auth: AuthenticatedFetch, opts: any) =>
            getRepoSnapshot(platform, repoPath, auth, opts),
          noCache: ctx.noCache,
        };
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        ctx.ruleBodies = new Map();

        await task.newListr(
          currentRules.map((rule) => ({
            title: rule.id,
            task: async () => {
              let body: string;
              if (rule.type === 'inline') {
                if (!rule.content) throw new Error(`Rule "${rule.id}" is type 'inline' but has no content.`);
                body = rule.content;
              } else if (rule.type === 'remote') {
                if (!rule.url) throw new Error(`Rule "${rule.id}" is type 'remote' but has no url.`);
                body = await fetchTextFile(rule.url, {
                  authFetch: repoFetchAuth,
                  sourceLabel: `rule "${rule.id}"`,
                });
              } else if (rule.type === 'github' || rule.type === 'gitlab') {
                if (!rule.def?.repo) throw new Error(`Rule "${rule.id}" is type '${rule.type}' but missing def.repo.`);
                const result = await fetchRepoFile(
                  rule.type,
                  rule.def.repo,
                  repoFetchCtx.getRepoSnapshot,
                  repoFetchAuth,
                  { noCache: ctx.noCache },
                );
                body = result.content;
              } else {
                throw new Error(`Unknown rule type: ${(rule as any).type}`);
              }
              const security = ctx.capabilitiesToUse.options?.security;
              if (isBlockedPhrasesEnabled(security)) {
                const blockedPhrases = loadBlockedPhrases(security, ctx.capabilitiesFile.path);
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
              ctx.ruleBodies!.set(rule.id, body);
            },
          })),
          { concurrent: false },
        );

        installRules(ctx.projectPath, currentRules, providers, ctx.ruleBodies, {
          onFileWritten: (filePath) => ctx.db.addManagedFile(ctx.projectId, filePath),
        });
        ctx.added += currentRules.length;
      },
    },
    {
      title: 'Configuring tools',
      task: async (ctx, task) => {
        const response = await fetch(
          `${ctx.serverStatus.url}/api/projects/${ctx.projectId}/configure`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ctx.capabilitiesToUse),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to configure project: ${errorText}`);
        }

        ctx.configureResult = await response.json();

        const result = ctx.configureResult as {
          toolValidation?: Array<{
            toolId: string;
            success: boolean;
            pendingAuth?: boolean;
            serverId?: string;
            remoteTool?: string;
            error?: string;
          }>;
        };

        if (result.toolValidation && result.toolValidation.length > 0) {
          const successful = result.toolValidation.filter((t) => t.success && !t.pendingAuth);
          const failed = result.toolValidation.filter((t) => !t.success && !t.pendingAuth);
          const pendingAuth = result.toolValidation.filter((t) => t.pendingAuth);

          if (failed.length > 0) {
            ctx.failed += failed.length;
            task.title = `Configuring tools — ${failed.length} of ${result.toolValidation.length} tool(s) failed validation`;
            const lines: string[] = [];
            lines.push(
              `${failed.length} of ${result.toolValidation.length} tool(s) failed validation:`,
            );
            for (const t of failed) {
              lines.push(`  • ${t.toolId}`);
              if (t.serverId && t.remoteTool) {
                lines.push(`      upstream tool "${t.remoteTool}" not found on server "@${t.serverId}"`);
              }
              if (t.error) lines.push(`      ${t.error}`);
            }
            lines.push('  Tip: check that tool names match what the MCP server provides,');
            lines.push('  server IDs are correct (e.g. "@server-name"), and that the MCP');
            lines.push('  servers are reachable.');
            ctx.errors.push(lines.join('\n'));
          } else if (pendingAuth.length > 0 && pendingAuth.length < result.toolValidation.length) {
            task.title = `Configuring tools — ${successful.length} validated, ${pendingAuth.length} pending OAuth2`;
          } else if (pendingAuth.length === 0) {
            task.title = `Configuring tools — ${result.toolValidation.length} validated`;
          }
        }

        const unexposed = getUnexposedToolIds(ctx.capabilitiesToUse);
        if (unexposed.length > 0) {
          ctx.warnings.push(
            `${unexposed.length} tool(s) are not exposed to MCP clients (not required by any skill): ` +
              `${unexposed.sort().join(', ')}. Add them to a skill's \`requires\` list to expose.`,
          );
        }
      },
    },
    {
      title: 'Registering MCP server',
      task: async (ctx) => {
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        const hasTools = ctx.capabilitiesToUse.tools.length > 0;
        const hasSubagents = (ctx.capabilitiesToUse.subagents ?? []).length > 0;
        if (hasTools || hasSubagents) {
          await registerMCPServer(ctx.projectPath, ctx.projectId, ctx.mcpUrl, providers);
        } else {
          await unregisterMCPServer(ctx.projectPath, ctx.projectId, providers);
        }
      },
    },
    {
      title: 'Installing sub-agents',
      enabled: (ctx) => {
        const installedAgents = ctx.db.getSubAgents(ctx.projectId);
        const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
        const currentAgentIds = new Set(currentSubagents.map((a) => a.id));
        const removedSubAgentIds = installedAgents
          .filter(({ agent_id }) => !currentAgentIds.has(agent_id))
          .map(({ agent_id }) => agent_id);
        return removedSubAgentIds.length > 0 || currentSubagents.length > 0;
      },
      task: (ctx, task) => {
        const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
        const installedAgents = ctx.db.getSubAgents(ctx.projectId);
        const currentSubagents = ctx.capabilitiesToUse.subagents ?? [];
        const currentAgentIds = new Set(currentSubagents.map((a) => a.id));

        const subTasks: Task<InstallCtx>[] = [];

        if (
          providers.some((id) => {
            const provider = getProvider(id);
            return (
              provider &&
              (provider.mcp?.supportsSubAgentEntries === false || provider.purgeStaleSubAgentMcp === true)
            );
          })
        ) {
          subTasks.push({
            title: 'Purging stale sub-agent MCP entries',
            task: () => purgeCursorSubAgentMCPEntries(ctx.projectPath),
          });
        }

        for (const { agent_id } of installedAgents) {
          if (!currentAgentIds.has(agent_id)) {
            subTasks.push({
              title: `Remove ${agent_id}`,
              task: async () => {
                await unregisterSubAgentMCPServer(ctx.projectPath, agent_id, providers);
                removeSubAgentInstructions(ctx.projectPath, agent_id, providers);
                ctx.db.removeSubAgent(ctx.projectId, agent_id);
              },
            });
          }
        }

        for (const subAgent of currentSubagents) {
          subTasks.push({
            title: subAgent.id,
            task: async () => {
              const agentMcpUrl = `${ctx.serverStatus.url}/${ctx.projectId}/agents/${subAgent.id}/mcp`;
              await registerSubAgentMCPServer(ctx.projectPath, subAgent.id, agentMcpUrl, providers);
              installSubAgentInstructions(
                ctx.projectPath,
                subAgent,
                ctx.capabilitiesToUse,
                providers,
              );
              ctx.db.upsertSubAgent(ctx.projectId, subAgent.id);
              ctx.added++;
            },
          });
        }

        return task.newListr(subTasks, { concurrent: false, rendererOptions: { collapseSubtasks: false } });
      },
    },
    {
      title: 'Opening credential setup',
      enabled: (ctx) => {
        const result = ctx.configureResult as any;
        return !!(result?.needsCredentials && result?.credentialsUrl);
      },
      task: async (ctx) => {
        const result = ctx.configureResult as any;
        const hasVariables = result.missingVariables && result.missingVariables.length > 0;
        const hasOAuth2 = result.oauth2Servers && result.oauth2Servers.length > 0;
        const needsOAuth2Connection = hasOAuth2 && result.oauth2Servers.some((s: any) => !s.isConnected);

        if (hasVariables && needsOAuth2Connection) {
          info('Credentials and OAuth2 connections required');
        } else if (needsOAuth2Connection) {
          info('OAuth2 connections required');
        } else {
          info('Credentials required');
        }

        if (hasVariables) {
          info(`Missing variables: ${result.missingVariables.join(', ')}`);
        }
        if (needsOAuth2Connection) {
          const disconnectedServers = result.oauth2Servers.filter((s: any) => !s.isConnected);
          info(`OAuth2 servers need connection: ${disconnectedServers.map((s: any) => s.serverId).join(', ')}`);
        }

        const opened = await openBrowser(result.credentialsUrl);
        if (opened) {
          info(`Browser opened: ${result.credentialsUrl}`);
        } else {
          info(`Could not open browser automatically. Open manually: ${result.credentialsUrl}`);
        }
      },
    },
  );

  return tasks;
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
  
  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format,
  );

  const reqCmds = capabilities.options?.requiresCommands;
  const projectId = generateProjectId(projectPath);
  const serverStatus = await ensureServer(VERSION);

  if (!serverStatus.running || !serverStatus.url) {
    console.error('✗ Failed to start server');
    process.exit(1);
  }

  const startedAt = Date.now();
  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);
  const existingLockfile = await loadLockfile(projectPath);
  const lockBuilder = new LockfileBuilder(noCache ? null : existingLockfile);
  const mcpUrl = `${serverStatus.url}/${projectId}/mcp`;

  let resolvedProviders: string[];
  try {
    db.upsertProject({ id: projectId, path: projectPath });
    resolvedProviders = await resolveProvidersForInstall({
      flagProvider,
      capabilitiesProviders: capabilities.providers,
      db,
      projectId,
    });
    capabilities.providers = resolvedProviders;
    db.setProjectProviders(projectId, resolvedProviders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    try {
      db.close();
    } catch {}
    process.exit(1);
  }

  try {
    const ctx = await runTasks(
      buildInstallTasks(reqCmds),
      { exitOnError: true },
      {
        projectPath,
        projectId,
        capabilitiesFile,
        capabilities,
        capabilitiesToUse: capabilities,
        envFile,
        flagProvider,
        noCache,
        db,
        settings,
        serverStatus: { running: true, url: serverStatus.url },
        resolvedProviders,
        lockBuilder,
        mcpUrl,
        resolvedRepos: new Map(),
        added: 0,
        failed: 0,
        skipped: 0,
        warnings: [],
        errors: [],
      },
    );

    for (const e of ctx.errors) error(e);
    for (const w of ctx.warnings) warn(w);
    info(`MCP Endpoint: ${ctx.mcpUrl}`);
    summary({
      added: ctx.added,
      failed: ctx.failed,
      skipped: ctx.skipped,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  } finally {
    try {
      db.close();
    } catch {}
  }
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
): Promise<{ removed: number; skipped: number; failed: number }> {
  const stats = { removed: 0, skipped: 0, failed: 0 };
  const managedFiles = db.getManagedFiles(projectId);

  if (managedFiles.length === 0) {
    return stats;
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
    return stats;
  }

  for (const dir of dirsToRemove) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        stats.removed++;
      } catch {
        stats.failed++;
        continue;
      }
    }

    db.removeManagedFile(projectId, dir);
  }

  return stats;
}

function buildInvalidSkillMessage(skill: Skill): string {
  const lines = [`Invalid skill definition: ${skill.id}`];
  if (!skill.type || !['inline', 'remote', 'github', 'gitlab', 'local', 'installed', 'plugin'].includes(skill.type)) {
    lines.push(`  Invalid or missing 'type'. Must be one of: 'inline', 'remote', 'github', 'gitlab', 'local', 'installed', 'plugin'`);
    lines.push(`  Current value: ${skill.type || '(not set)'}`);
  } else if (skill.type === 'inline') {
    lines.push(`  Type is 'inline' but 'def.content' is missing`);
  } else if (skill.type === 'local') {
    lines.push(`  Type is 'local' but 'def.path' is missing`);
  } else if (skill.type === 'github') {
    lines.push(`  Type is 'github' but 'def.repo' is missing or invalid`);
    if (skill.def.repo) lines.push(`  Current value: '${skill.def.repo}'`);
  } else if (skill.type === 'gitlab') {
    lines.push(`  Type is 'gitlab' but 'def.repo' is missing or invalid`);
    if (skill.def.repo) lines.push(`  Current value: '${skill.def.repo}'`);
  } else if (skill.type === 'remote') {
    lines.push(`  Type is 'remote' but 'def.url' is missing`);
  }
  return lines.join('\n');
}

async function installOneSkill(
  skill: Skill,
  projectPath: string,
  projectId: string,
  clients: string[],
  db: CapaDatabase,
  settings: any,
  capabilities: Capabilities,
  capabilitiesFilePath: string,
  lockBuilder: LockfileBuilder,
  noCache: boolean,
  resolvedRepos: Map<string, GetSnapshotResult>,
): Promise<SkillInstallOutcome> {
  const authFetch = createAuthenticatedFetch(db);

  let skillMarkdown: string;
    let additionalFiles: Map<string, string> = new Map();
    let skillSourceDir: string | null = null;
    
    if (skill.type === 'installed') {
      return 'skipped';
    } else if (skill.type === 'plugin') {
      return 'skipped';
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
        skillSourceDir = skillDir;
        const skillData = readSkillFromDirectory(skillMdPath);
        skillMarkdown = skillData.markdown;
        additionalFiles = skillData.additionalFiles;
      } catch (error: any) {
        throw new Error(`Failed to install local skill ${skill.id}: ${error.message || error}`);
      }
    } else if ((skill.type === 'github' || skill.type === 'gitlab') && skill.def.repo) {
      // GitHub/GitLab skill - resolve a snapshot (cache + lockfile aware)
      const platform: CachePlatform = skill.type;
      const platformLabel = getGitProvider(platform)?.displayName ?? platform;
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
          if (isVerbose()) {
            console.log(`    Resolving repository: ${repoPath}${sourceLabel}...`);
          }

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
              try {
                db.close();
              } catch {}
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
        skillSourceDir = dirname(skillMdPath);
        skillMarkdown = skillData.markdown;
        additionalFiles = skillData.additionalFiles;

      } catch (error: any) {
        throw new Error(`Failed to install skill from ${platformLabel}: ${error.message || error}`);
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
              displayIntegrationPrompt(getGitProvider(repoInfo.platform)?.displayName ?? repoInfo.platform, integrationsUrl);
              try {
                db.close();
              } catch {}
              process.exit(1);
            }
          }
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        skillMarkdown = await response.text();
      } catch (error: any) {
        throw new Error(`Failed to fetch skill ${skill.id}: ${error.message || error}`);
      }
    } else {
      throw new Error(buildInvalidSkillMessage(skill));
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
        throw new Error(`Failed to load blocked phrases for skill ${skill.id}: ${err.message}`);
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

        try {
          db.close();
        } catch {}
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
          try {
            db.close();
          } catch {}
          process.exit(1);
        }
        // Clean up existing directory
        rmSync(skillDir, { recursive: true, force: true });
      }
      
      // Create skill directory and write payload
      if (skillSourceDir) {
        copySkillTree({ src: skillSourceDir, dst: skillDir });
        writeFileSync(skillMdPath, skillMarkdown, 'utf-8');
        for (const [filePath, content] of additionalFiles) {
          if (!isTextFile(filePath)) continue;
          const fullPath = join(skillDir, filePath);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, content, 'utf-8');
        }
      } else {
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillMdPath, skillMarkdown, 'utf-8');
        for (const [filePath, content] of additionalFiles) {
          const fullPath = join(skillDir, filePath);
          const fileDir = dirname(fullPath);
          if (!existsSync(fileDir)) {
            mkdirSync(fileDir, { recursive: true });
          }
          writeFileSync(fullPath, content, 'utf-8');
        }
      }
      
      db.addManagedFile(projectId, skillDir);
    }

  return 'installed';
}
