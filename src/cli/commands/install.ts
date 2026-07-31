import { resolve } from 'path';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { VERSION } from '../../version';
import { resolveProvidersForInstall } from '../../shared/providers/resolve';
import { LockfileBuilder, loadLockfile } from '../../shared/lockfile';
import { runTasks, summary, info, warn, error, setFlags, getFlags } from '../ui';
import { buildInstallTasks } from './install-tasks';
import type { InstallCtx, InstallOptions } from './install-tasks';
import { refuseIfWrapWorkspace } from '../utils/wrap/marker';

export type { InstallOptions, GetRepoSnapshotFn } from './install-tasks';

function failExit(message: string, exitProcess: boolean): never {
  console.error(`✗ ${message}`);
  if (exitProcess) process.exit(1);
  throw new Error(message);
}

export async function installCommand(
  envFileOrOptions?: string | boolean | InstallOptions,
): Promise<void> {
  // Backwards compatibility: callers may pass either the legacy `envFile`
  // string/boolean or the new `InstallOptions` object.
  let envFile: string | boolean | undefined;
  let flagProvider: string | undefined;
  let noCache = false;
  let projectPath = process.cwd();
  let identityPath: string | undefined;
  let exitProcess = true;
  let quiet = false;
  if (typeof envFileOrOptions === 'object' && envFileOrOptions !== null) {
    envFile = envFileOrOptions.envFile;
    flagProvider = envFileOrOptions.provider;
    noCache = !!envFileOrOptions.noCache;
    if (envFileOrOptions.projectPath) projectPath = resolve(envFileOrOptions.projectPath);
    identityPath = envFileOrOptions.identityPath
      ? resolve(envFileOrOptions.identityPath)
      : undefined;
    if (envFileOrOptions.exitProcess === false) exitProcess = false;
    quiet = !!envFileOrOptions.quiet;
  } else {
    envFile = envFileOrOptions;
  }

  const prevQuiet = getFlags().quiet;
  if (quiet) setFlags({ quiet: true });
  try {
    await installCommandBody({
      envFile,
      flagProvider,
      noCache,
      projectPath,
      identityPath,
      exitProcess,
      // Only refuse wrap cwd when the caller did not pass an explicit projectPath
      // (wrap itself always passes one).
      refuseWrapCwd:
        typeof envFileOrOptions !== 'object' ||
        envFileOrOptions === null ||
        !envFileOrOptions.projectPath,
    });
  } finally {
    if (quiet) setFlags({ quiet: prevQuiet });
  }
}

async function installCommandBody(opts: {
  envFile: string | boolean | undefined;
  flagProvider: string | undefined;
  noCache: boolean;
  projectPath: string;
  identityPath: string | undefined;
  exitProcess: boolean;
  refuseWrapCwd: boolean;
}): Promise<void> {
  const { envFile, flagProvider, noCache, exitProcess, refuseWrapCwd } = opts;
  const projectPath = opts.projectPath;
  const identityPath = opts.identityPath;
  const idPath = identityPath ?? projectPath;

  if (refuseWrapCwd) {
    if (await refuseIfWrapWorkspace('install')) {
      failExit('Refusing to install inside a wrap workspace.', exitProcess);
    }
  }

  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    failExit('No capabilities file found. Run "capa init" first.', exitProcess);
  }

  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format,
  );

  const reqCmds = capabilities.options?.requiresCommands;
  const projectId = generateProjectId(idPath);
  const serverStatus = await ensureServer(VERSION);

  if (!serverStatus.running || !serverStatus.url) {
    failExit('Failed to start server', exitProcess);
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
    // Always store the real project path for MCP tool cwd / identity.
    db.upsertProject({ id: projectId, path: idPath });
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
    failExit(message, exitProcess);
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
      failExit(`Install completed with ${initialCtx.failed} failure(s).`, exitProcess);
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
      if (exitProcess) {
        console.error(`✗ ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
    throw err;
  } finally {
    try {
      db.close();
    } catch {}
  }
}
