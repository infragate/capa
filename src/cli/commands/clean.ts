import { existsSync, rmSync, statSync } from 'fs';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { unregisterMCPServer, unregisterSubAgentMCPServer } from '../utils/mcp-client-manager';
import { cleanAgentsFile, removeSubAgentInstructions } from '../utils/agents-file';
import { cleanRules } from '../utils/rules-installer';
import { getLockfilePath } from '../../shared/lockfile';
import { resolveProvidersForClean } from '../../shared/providers/resolve';
import { header, footer, info, warn, error, runTasks } from '../ui';
import type { Task } from '../ui';

export async function cleanCommand(): Promise<void> {
  const projectPath = process.cwd();

  header('Clean project');

  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    error('No capabilities file found.');
    process.exit(1);
  }

  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format,
  );

  const projectId = generateProjectId(projectPath);
  info(`Project ID: ${projectId}`);

  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);

  const providers = resolveProvidersForClean({
    capabilitiesProviders: capabilities.providers,
    db,
    projectId,
  });
  if (providers.length === 0) {
    warn('No providers found. Skipping provider-specific cleanup.');
  }

  const managedFiles = db.getManagedFiles(projectId);

  const tasks: Task[] = [
    {
      title: 'Remove managed files',
      task: async (_, task) => {
        if (managedFiles.length === 0) {
          info('No files to clean.');
          return;
        }
        return task.newListr(
          managedFiles.map((filePath) => ({
            title: filePath,
            task: async (__, subTask) => {
              if (existsSync(filePath)) {
                try {
                  const stats = statSync(filePath);
                  if (stats.isDirectory()) {
                    rmSync(filePath, { recursive: true, force: true });
                  } else {
                    rmSync(filePath);
                  }
                } catch (err) {
                  error(`Failed to remove ${filePath}: ${err}`);
                }
              } else {
                subTask.skip('Already removed');
              }
              db.removeManagedFile(projectId, filePath);
            },
          })),
          { exitOnError: false },
        );
      },
    },
    {
      // Run unconditionally when providers are known: sub-agent integrations
      // (Claude's `foldSubAgentsIntoInstructions`, Codex's `AGENTS.md`, etc.)
      // write capa-managed snippets into these files independently of whether
      // a top-level `agents:` block exists in capabilities.yaml, so gating the
      // cleanup on `capabilities.agents` left CLAUDE.md / AGENTS.md behind for
      // any project that only used sub-agents.
      title: 'Clean agent instructions',
      enabled: () => providers.length > 0,
      task: async () => {
        cleanAgentsFile(projectPath, providers);
      },
    },
    {
      title: 'Clean rules',
      enabled: () => providers.length > 0,
      task: async () => {
        const ruleIds = (capabilities.rules ?? []).map((r) => r.id);
        cleanRules(projectPath, providers, ruleIds);
      },
    },
    {
      title: 'Remove lockfile',
      task: async () => {
        const lockfilePath = getLockfilePath(projectPath);
        if (existsSync(lockfilePath)) {
          try {
            rmSync(lockfilePath, { force: true });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            error(`Failed to remove lockfile ${lockfilePath}: ${message}`);
          }
        }
      },
    },
    {
      title: 'Unregister sub-agents',
      enabled: () => providers.length > 0 && db.getSubAgents(projectId).length > 0,
      task: async (_, task) => {
        const installedSubAgents = db.getSubAgents(projectId);
        return task.newListr(
          installedSubAgents.map(({ agent_id }) => ({
            title: agent_id,
            task: async () => {
              await unregisterSubAgentMCPServer(projectPath, agent_id, providers);
              removeSubAgentInstructions(projectPath, agent_id, providers);
            },
          })),
        );
      },
    },
    {
      title: 'Unregister MCP server from clients',
      enabled: () => providers.length > 0,
      task: async () => {
        await unregisterMCPServer(projectPath, projectId, providers);
      },
    },
    {
      title: 'Remove project data',
      task: async () => {
        db.deleteProject(projectId);
      },
    },
  ];

  try {
    await runTasks(tasks);
    footer('Cleanup complete!');
  } finally {
    db.close();
  }
}
