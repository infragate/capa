import type { Capabilities } from '../../../types/capabilities';
import type { CapaDatabase } from '../../../db/database';
import type { loadSettings } from '../../../shared/config';
import type { LockfileBuilder } from '../../../shared/lockfile';
import type { GetSnapshotResult, CachePlatform } from '../../../shared/cache';
import type { AuthenticatedFetch } from '../../../shared/authenticated-fetch';

export type SkillInstallOutcome = 'installed' | 'skipped' | 'failed';

export interface InstallCtx {
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

export interface InstallOptions {
  /** Path to a .env file (or boolean true to use ./.env). Mirrors the existing API. */
  envFile?: string | boolean;
  /** Install for a single provider (overrides capabilities file and stored selection). */
  provider?: string;
  /** When true, ignore lockfile + on-disk cache and re-resolve every remote source. */
  noCache?: boolean;
  /** Write root for provider configs (default: process.cwd()). */
  projectPath?: string;
  /**
   * Path used for generateProjectId + db.upsertProject path (default: projectPath).
   * Wrap uses the real project here while writing into a shadow workspace.
   */
  identityPath?: string;
  /**
   * When false, throw on failure instead of process.exit (for wrap live re-apply).
   * Default true.
   */
  exitProcess?: boolean;
  /**
   * Suppress install UI output (for wrap capabilities live re-apply).
   * Default false.
   */
  quiet?: boolean;
  /**
   * Skip `requiresCommands` PATH checks (wrap live re-apply — already verified
   * at session start; re-running `where`/`which` flashes console windows on Windows).
   */
  skipPrerequisites?: boolean;
  /**
   * Skip auto-opening the credential setup browser (wrap live re-apply).
   * Warnings about missing credentials are still recorded.
   */
  skipCredentialOpen?: boolean;
  /**
   * Write provider-native files from the capabilities file without starting
   * the capa server or registering a capa MCP proxy entry.
   */
  passthrough?: boolean;
}

export type GetRepoSnapshotFn = (
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts?: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean }
) => Promise<GetSnapshotResult>
