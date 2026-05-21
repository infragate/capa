import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { VERSION } from '../../version';
import { resolveProvidersForInstall } from '../../shared/providers/resolve';
import { LockfileBuilder, loadLockfile } from '../../shared/lockfile';
import { runTasks, summary, info, warn, error } from '../ui';
import { buildInstallTasks } from './install-tasks';
import type { InstallCtx, InstallOptions } from './install-tasks';

export type { InstallOptions, GetRepoSnapshotFn } from './install-tasks';

export async function installCommand(
  envFileOrOptions?: string | boolean | InstallOptions,
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

  // Hoisted so the catch block can surface ctx.errors accumulated before the throw.
  const initialCtx: InstallCtx = {
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
  };

  try {
    const ctx = await runTasks(buildInstallTasks(reqCmds), { exitOnError: true }, initialCtx);

    for (const e of ctx.errors) error(e);
    for (const w of ctx.warnings) warn(w);
    info(`MCP Endpoint: ${ctx.mcpUrl}`);
    summary({
      added: ctx.added,
      failed: ctx.failed,
      skipped: ctx.skipped,
      elapsedMs: Date.now() - startedAt,
    });
    // Exit non-zero on accumulated per-task failures (continue-on-error mode).
    if (initialCtx.failed > 0) {
      process.exit(1);
    }
  } catch (err: unknown) {
    for (const e of initialCtx.errors) error(e);
    for (const w of initialCtx.warnings) warn(w);
    summary({
      added: initialCtx.added,
      failed: initialCtx.failed,
      skipped: initialCtx.skipped,
      elapsedMs: Date.now() - startedAt,
    });
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
