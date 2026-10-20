import { existsSync } from 'fs';
import { resolve } from 'path';
import { Database } from 'bun:sqlite';
import { readInstallState } from '../../db/projects';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { peekDatabasePath } from '../../shared/config';
import { computeInstallFingerprint, fingerprintChanges } from '../../shared/install-fingerprint';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { peekSecretStorageTier } from '../../shared/secret-crypto';
import { extractRequiredVariables } from '../../shared/variable-resolver';
import { VERSION } from '../../version';
import { getFlags } from '../ui/flags';
import { getServerStatus } from '../utils/server-manager';

export interface ServerReport {
  running: boolean;
  pid?: number;
  version?: string;
  port?: number;
  url?: string;
  /** null when the server isn't running. */
  health: 'healthy' | 'unhealthy' | 'not-responding' | null;
  uptimeSeconds?: number;
  secretStorage: { tier: string; undecryptable: number };
}

export type ProjectState = 'not-initialized' | 'not-installed' | 'out-of-date' | 'installed';

export interface ProjectReport {
  path: string;
  state: ProjectState;
  capabilitiesFile?: string;
  installedAt?: number;
  installedWith?: string;
  /** Why the project is out of date. */
  reasons: string[];
  providers: string[];
  counts?: { skills: number; plugins: number; servers: number; hooks: number };
  /** Things that need attention even when installed. */
  problems: string[];
}

/**
 * `capa status`: the server, and the project that owns the current folder
 * (#332). Until project ownership is defined (#335), that is the current
 * folder, as for every other command.
 */
export async function statusCommand(
  opts: { json?: boolean; strict?: boolean; cwd?: string } = {},
): Promise<void> {
  const json = opts.json || getFlags().json;
  if (!json) console.log('Checking capa status...\n');

  const projectPath = resolve(opts.cwd ?? process.cwd());
  const [server, project] = await Promise.all([
    collectServerReport(),
    // Never let a project problem hide the server section.
    collectProjectReport(projectPath).catch(
      (err): ProjectReport => ({
        path: projectPath,
        state: 'not-initialized',
        reasons: [],
        providers: [],
        problems: [`The project could not be checked: ${err instanceof Error ? err.message : String(err)}`],
      }),
    ),
  ]);

  if (json) {
    console.log(JSON.stringify({ server, project }, null, 2));
  } else {
    printServer(server);
    console.log('');
    printProject(project);
  }

  if (opts.strict && (project.state !== 'installed' || project.problems.length > 0)) {
    process.exitCode = 1;
  }
}

async function collectServerReport(): Promise<ServerReport> {
  const status = await getServerStatus();
  const report: ServerReport = {
    running: status.running,
    health: null,
    secretStorage: { tier: peekSecretStorageTier(), undecryptable: 0 },
  };
  if (!status.running) return report;
  if (status.pid) report.pid = status.pid;
  if (status.version) report.version = status.version;
  if (status.port) report.port = status.port;
  if (!status.url) return report;
  report.url = status.url;
  try {
    const response = await fetch(`${status.url}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      report.health = 'unhealthy';
      return report;
    }
    const data = (await response.json()) as {
      uptime?: number;
      secretStorage?: { tier?: string; undecryptable?: number };
    };
    report.health = 'healthy';
    if (data.uptime) report.uptimeSeconds = data.uptime;
    if (data.secretStorage?.tier) report.secretStorage.tier = data.secretStorage.tier;
    report.secretStorage.undecryptable = data.secretStorage?.undecryptable ?? 0;
  } catch {
    report.health = 'not-responding';
  }
  return report;
}

export async function collectProjectReport(
  projectPath: string,
  dbPath?: string,
): Promise<ProjectReport> {
  const report: ProjectReport = { path: projectPath, state: 'not-initialized', reasons: [], providers: [], problems: [] };
  const problem = (prefix: string, err: unknown) =>
    report.problems.push(`${prefix}: ${err instanceof Error ? err.message : String(err)}`);

  let file: Awaited<ReturnType<typeof detectCapabilitiesFile>>;
  try {
    file = await detectCapabilitiesFile(projectPath);
  } catch (err) {
    // e.g. both capabilities.yaml and capabilities.json in one folder.
    problem('The capabilities file is ambiguous', err);
    return report;
  }
  if (!file) return report;
  report.capabilitiesFile = file.path;
  report.state = 'not-installed';

  let capabilities: Awaited<ReturnType<typeof parseCapabilitiesFile>> | null = null;
  try {
    capabilities = await parseCapabilitiesFile(file.path, file.format);
    report.counts = {
      skills: capabilities.skills?.length ?? 0,
      plugins: capabilities.plugins?.length ?? 0,
      servers: capabilities.servers?.length ?? 0,
      hooks: capabilities.hooks?.length ?? 0,
    };
  } catch (err) {
    problem("The capabilities file can't be read", err);
  }

  // Read-only: no ~/.capa, settings, schema setup or secret migration just to look.
  const path = dbPath ?? peekDatabasePath();
  if (!existsSync(path)) return report;
  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch (err) {
    problem("capa's database can't be opened", err);
    return report;
  }
  try {
    const projectId = generateProjectId(projectPath);
    report.providers = queryOr(db, [], (d) =>
      (
        d
          .query('SELECT provider_id FROM project_providers WHERE project_id = ? ORDER BY rowid')
          .all(projectId) as Array<{ provider_id: string }>
      ).map((r) => r.provider_id),
    );
    const installed = readInstallState(db, projectId);
    if (!installed) {
      // Only `capa install` records providers: installed before installs were recorded.
      if (report.providers.length > 0) {
        report.state = 'out-of-date';
        report.reasons.push(
          'Installed by an older capa that did not record installs. Run "capa install" once so status can track changes.',
        );
      }
      return report;
    }

    report.installedAt = installed.installedAt;
    report.installedWith = installed.capaVersion;
    // What the install produced, plugin-provided items included.
    report.counts = installed.counts;
    const current = await computeInstallFingerprint(projectPath);
    for (const change of current ? fingerprintChanges(installed.fingerprint, current) : []) {
      report.reasons.push(
        change === 'capabilities'
          ? 'The capabilities file changed since the last install.'
          : 'capabilities.lock changed since the last install.',
      );
    }
    if (installed.capaVersion !== VERSION) {
      report.reasons.push(`Installed with capa ${installed.capaVersion}; this is capa ${VERSION}.`);
    }
    report.state = report.reasons.length > 0 ? 'out-of-date' : 'installed';

    if (!installed.completed) {
      report.problems.push('The last install stopped before finishing.');
    } else if (installed.failed > 0) {
      report.problems.push(`The last install had ${installed.failed} failure(s).`);
    }
    report.problems.push(...installed.errors);

    if (capabilities) {
      // Presence only: values stay encrypted, nothing is decrypted to check.
      const missing = extractRequiredVariables(capabilities).filter(
        (name) =>
          !queryOr(db, false, (d) => {
            const row = d
              .query('SELECT value FROM variables WHERE project_id = ? AND key = ?')
              .get(projectId, name) as { value: string | null } | null;
            return !!row?.value;
          }),
      );
      if (missing.length > 0) {
        report.problems.push(`Variables without a value: ${missing.join(', ')}.`);
      }
    }
  } catch (err) {
    problem("capa's database can't be read", err);
  } finally {
    db.close();
  }
  return report;
}

/** Run a query, or return `fallback` when the table doesn't exist yet. */
function queryOr<T>(db: Database, fallback: T, run: (db: Database) => T): T {
  try {
    return run(db);
  } catch {
    return fallback;
  }
}

function printServer(server: ServerReport): void {
  console.log('Server');
  if (!server.running) {
    console.log('  Status: ✗ Not running (start it with "capa start")');
  } else {
    console.log('  Status: ✓ Running');
    if (server.pid) console.log(`  PID: ${server.pid}`);
    if (server.version) console.log(`  Version: ${server.version}`);
    if (server.port) console.log(`  Port: ${server.port}`);
    if (server.url) console.log(`  URL: ${server.url}`);
    if (server.health === 'healthy') console.log('  Health: ✓ Healthy');
    if (server.health === 'unhealthy') console.log('  Health: ⚠ Responding but unhealthy');
    if (server.health === 'not-responding') {
      console.log('  Health: ⚠ Not responding (process exists but server may be starting or stuck)');
    }
    if (server.uptimeSeconds) console.log(`  Uptime: ${formatUptime(server.uptimeSeconds)}`);
  }
  console.log(`  Secret storage: ${formatSecretTier(server.secretStorage.tier)}`);
  if (server.secretStorage.undecryptable > 0) {
    console.log(
      `  ⚠ ${server.secretStorage.undecryptable} stored secret(s) can't be decrypted with the current master key (left untouched)`,
    );
  }
}

function printProject(project: ProjectReport): void {
  console.log(`Project  ${project.path}`);
  switch (project.state) {
    case 'not-initialized':
      console.log('  Status: Not initialized: no capabilities file in this folder.');
      console.log('  Run "capa init" to create one.');
      return;
    case 'not-installed':
      console.log('  Status: Not installed yet.');
      console.log('  Run "capa install" to install it.');
      break;
    case 'out-of-date':
      console.log('  Status: ⚠ Out of date. Run "capa install" to update it.');
      for (const reason of project.reasons) console.log(`    - ${reason}`);
      break;
    case 'installed':
      console.log(
        project.problems.length > 0 ? '  Status: ⚠ Installed, with problems' : '  Status: ✓ Installed',
      );
      break;
  }
  if (project.installedAt) {
    console.log(
      `  Last install: ${new Date(project.installedAt).toLocaleString()} (capa ${project.installedWith})`,
    );
  }
  if (project.providers.length > 0) console.log(`  Providers: ${project.providers.join(', ')}`);
  if (project.counts) {
    const c = project.counts;
    console.log(`  Skills: ${c.skills} · Plugins: ${c.plugins} · Servers: ${c.servers} · Hooks: ${c.hooks}`);
  }
  for (const problem of project.problems) console.log(`  ⚠ ${problem}`);
}

function formatSecretTier(tier: string): string {
  if (tier === 'file') return 'file (fallback)';
  return tier;
}

/**
 * Format uptime in seconds to human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}
