import { resolve } from 'path';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { VERSION } from '../../version';
import {
  resolveProvidersForInstall,
  validateProvider,
} from '../../shared/providers/resolve';
import { LockfileBuilder, loadLockfile } from '../../shared/lockfile';
import { runTasks, summary, info, warn, error, setFlags, getFlags } from '../ui';
import { buildInstallTasks } from './install-tasks';
import type { InstallCtx, InstallOptions } from './install-tasks';
import { refuseIfWrapWorkspace } from '../utils/wrap/marker';
import { isUnderWrapWorkspacesDir } from '../../shared/workspaces/paths';

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
  let skipPrerequisites = false;
  let skipCredentialOpen = false;
  let passthrough = false;
  let persistProviders = true;
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
    skipPrerequisites = !!envFileOrOptions.skipPrerequisites;
    skipCredentialOpen = !!envFileOrOptions.skipCredentialOpen;
    passthrough = !!envFileOrOptions.passthrough;
    if (envFileOrOptions.persistProviders === false) persistProviders = false;
  } else {
    envFile = envFileOrOptions;
  }

  if (passthrough) {
    const { passthroughInstall } = await import('../utils/passthrough');
    await passthroughInstall({
      envFile,
      provider: flagProvider,
      noCache,
      projectPath,
      exitProcess,
    });
    return;
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
      skipPrerequisites,
      skipCredentialOpen,
      persistProviders,
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
  skipPrerequisites: boolean;
  skipCredentialOpen: boolean;
  persistProviders: boolean;
  refuseWrapCwd: boolean;
}): Promise<void> {
  const {
    envFile,
    flagProvider,
    noCache,
    exitProcess,
    skipPrerequisites,
    skipCredentialOpen,
    persistProviders,
    refuseWrapCwd,
  } = opts;
  const projectPath = opts.projectPath;
  const identityPath = opts.identityPath;
  const idPath = identityPath ?? projectPath;

  if (refuseWrapCwd) {
    if (await refuseIfWrapWorkspace('install')) {
      failExit('Refusing to install inside a wrap workspace.', exitProcess);
    }
  }

  // Never register a shadow workspace path as the project identity (even when
  // wrap itself installs into the workspace with identityPath = real project).
  if (isUnderWrapWorkspacesDir(idPath)) {
    failExit(
      'Refusing to register a wrap workspace path as a project. Use the real project path.',
      exitProcess,
    );
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
  let configureProviders: string[];
  try {
    // Always store the real project path for MCP tool cwd / identity.
    db.upsertProject({ id: projectId, path: idPath });
    const authoredProviders = [...(capabilities.providers ?? [])];
    resolvedProviders = await resolveProvidersForInstall({
      flagProvider,
      capabilitiesProviders: capabilities.providers,
      db,
      projectId,
    });
    capabilities.providers = resolvedProviders;
    // Wrap installs into a shadow workspace under the real project identity.
    // Do not overwrite the stored provider preference — otherwise
    // `capa wrap claude` would make a later `capa install` target Claude.
    if (persistProviders) {
      db.setProjectProviders(projectId, resolvedProviders);
    }

    // Shadow wrap: local file writes use `resolvedProviders` (e.g. claude-code),
    // but POST /configure must keep the identity project's authored providers
    // so the real repo / live session stay on cursor (or whatever the file says).
    const isWrapInstall =
      !!identityPath &&
      (process.platform === 'win32'
        ? resolve(identityPath).toLowerCase() !== resolve(projectPath).toLowerCase()
        : resolve(identityPath) !== resolve(projectPath));
    if (isWrapInstall) {
      if (authoredProviders.length > 0) {
        configureProviders = authoredProviders.map((p) => validateProvider(p));
      } else {
        const stored = db.getProjectProviders(projectId);
        configureProviders = stored.length > 0 ? stored : [];
      }
    } else {
      configureProviders = resolvedProviders;
    }
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
    configureProviders,
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
    const ctx = await runTasks(
      buildInstallTasks(reqCmds, { skipPrerequisites, skipCredentialOpen }),
      { exitOnError: true },
      initialCtx,
    );

    for (const e of ctx.errors) error(e);
    for (const w of ctx.warnings) warn(w);
    // Match register-mcp-server: only surface the endpoint when MCP wiring is active.
    const toolExposure = ctx.capabilitiesToUse.options?.toolExposure;
    const mcpRegistered =
      toolExposure !== 'none' &&
      (ctx.capabilitiesToUse.tools.length > 0 ||
        (ctx.capabilitiesToUse.subagents ?? []).length > 0);
    if (mcpRegistered) {
      info(`MCP Endpoint: ${ctx.mcpUrl}`);
    }
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
