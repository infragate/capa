/**
 * Discover and stop live `capa wrap` processes without a PID registry.
 * `capa stop` scans the process table for capa binaries whose argv includes `wrap`.
 * Project-scoped stop also reads wrap-session.json files under ~/.capa/workspaces.
 */

import { readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { getWorkspacesDir, WORKSPACE_MARKER } from '../../../shared/workspaces/paths';
import { pathsEqual, readWrapSession, WRAP_SESSION_FILE } from './session-file';

export function isPidRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    return code === 'EPERM';
  }
}

function tryKill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export interface WrapProcess {
  pid: number;
  commandLine: string;
}

/**
 * Normalize a path for substring matching inside process command lines.
 */
export function normalizePathForMatch(p: string): string {
  const abs = resolve(p);
  if (process.platform === 'win32') {
    return abs.replace(/\//g, '\\').toLowerCase();
  }
  return abs;
}

/**
 * True when a process command line belongs to a wrap session for `realProjectPath`
 * (or one of its wrap workspace/cache paths).
 */
export function commandLineMatchesProject(
  commandLine: string,
  realProjectPath: string,
  extraPaths: string[] = [],
): boolean {
  const haystack =
    process.platform === 'win32' ? commandLine.replace(/\//g, '\\').toLowerCase() : commandLine;
  const needles = [realProjectPath, ...extraPaths].map(normalizePathForMatch).filter(Boolean);
  return needles.some((needle) => needle.length > 1 && haystack.includes(needle));
}

/**
 * List capa processes whose argv includes `wrap` or `__wrap_watch__`.
 */
export async function listWrapProcesses(): Promise<WrapProcess[]> {
  const self = process.pid;
  const procs: WrapProcess[] = [];

  if (process.platform === 'win32') {
    try {
      const proc = Bun.spawn(
        [
          'powershell',
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name = 'capa.exe'" | ` +
            `Where-Object { ($_.CommandLine -match '\\swrap(\\s|$)' -or $_.CommandLine -match '__wrap_watch__') -and $_.ProcessId -ne ${self} } | ` +
            `ForEach-Object { "{0}\t{1}" -f $_.ProcessId, $_.CommandLine }`,
        ],
        { stdout: 'pipe', stderr: 'ignore' },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      for (const line of out.split(/\r?\n/)) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const n = parseInt(line.slice(0, tab).trim(), 10);
        const cmd = line.slice(tab + 1);
        if (Number.isFinite(n) && n > 0 && cmd) {
          procs.push({ pid: n, commandLine: cmd });
        }
      }
    } catch {
      // ignore
    }
    return procs;
  }

  try {
    const proc = Bun.spawn(['ps', '-ax', '-o', 'pid=,command='], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!m) continue;
      const pid = parseInt(m[1]!, 10);
      const cmd = m[2]!;
      if (pid === self) continue;
      if (!/\bwrap\b/.test(cmd) && !/__wrap_watch__/.test(cmd)) continue;
      if (!/\bcapa(?:\.exe)?\b/i.test(cmd) && !/src\/cli\/index\.ts\b/.test(cmd)) continue;
      procs.push({ pid, commandLine: cmd });
    }
  } catch {
    // ignore
  }
  return procs;
}

/**
 * Find capa processes whose argv includes `wrap`.
 */
export async function findWrapPids(): Promise<number[]> {
  const procs = await listWrapProcesses();
  return [...new Set(procs.map((p) => p.pid))];
}

async function listWorkspacePathsForProject(realProjectPath: string): Promise<string[]> {
  const real = resolve(realProjectPath);
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) return [];

  const paths: string[] = [];
  for (const name of readdirSync(dir)) {
    const cachePath = join(dir, name);
    try {
      if (!statSync(cachePath).isDirectory()) continue;
      const markerPath = join(cachePath, WORKSPACE_MARKER);
      if (!existsSync(markerPath)) continue;
      const marker = (await Bun.file(markerPath).json()) as { realProjectPath?: string; workingDir?: string; cachePath?: string };
      if (!marker?.realProjectPath || !pathsEqual(marker.realProjectPath, real)) continue;
      paths.push(cachePath);
      if (marker.workingDir) {
        paths.push(join(cachePath, marker.workingDir));
      }
      if (marker.cachePath) {
        paths.push(marker.cachePath);
      }
    } catch {
      // skip
    }
  }
  return paths;
}

async function pidsFromSessionFiles(realProjectPath: string): Promise<number[]> {
  const real = resolve(realProjectPath);
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) return [];

  const pids: number[] = [];
  for (const name of readdirSync(dir)) {
    const cachePath = join(dir, name);
    try {
      if (!statSync(cachePath).isDirectory()) continue;
      if (!existsSync(join(cachePath, WRAP_SESSION_FILE))) continue;
      const session = await readWrapSession(cachePath);
      if (!session || !pathsEqual(session.realProjectPath, real)) continue;
      pids.push(session.pid);
      if (session.watchPid) pids.push(session.watchPid);
    } catch {
      // skip
    }
  }
  return pids;
}

/**
 * Find wrap / __wrap_watch__ PIDs belonging to a specific real project path.
 */
export async function findWrapPidsForProject(realProjectPath: string): Promise<number[]> {
  const real = resolve(realProjectPath);
  const workspacePaths = await listWorkspacePathsForProject(real);
  const fromSessions = await pidsFromSessionFiles(real);
  const procs = await listWrapProcesses();
  const fromArgv = procs
    .filter((p) => commandLineMatchesProject(p.commandLine, real, workspacePaths))
    .map((p) => p.pid);

  return [...new Set([...fromSessions, ...fromArgv])].filter(
    (pid) => pid !== process.pid && Number.isFinite(pid) && pid > 0,
  );
}

async function terminatePids(pids: number[]): Promise<void> {
  const unique = [...new Set(pids)].filter((pid) => pid !== process.pid && isPidRunning(pid));
  for (const pid of unique) {
    tryKill(pid, 'SIGTERM');
  }
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (unique.every((pid) => !isPidRunning(pid))) break;
  }
  for (const pid of unique) {
    if (isPidRunning(pid)) tryKill(pid, 'SIGKILL');
  }
}

/**
 * Stop every live `capa wrap` process. Returns how many PIDs were targeted.
 */
export async function stopAllWrapSessions(): Promise<number> {
  const pids = await findWrapPids();
  if (pids.length === 0) return 0;
  await terminatePids(pids);
  return pids.length;
}

/**
 * Stop wrap sessions for one real project. Returns how many PIDs were targeted.
 */
export async function stopWrapSessionsForProject(realProjectPath: string): Promise<number> {
  const pids = await findWrapPidsForProject(realProjectPath);
  if (pids.length === 0) return 0;
  await terminatePids(pids);
  return pids.length;
}
