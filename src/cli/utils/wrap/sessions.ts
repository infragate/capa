/**
 * Discover and stop live `capa wrap` processes without a PID registry.
 * `capa stop` scans the process table for capa binaries whose argv includes `wrap`.
 */

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

/**
 * Find capa processes whose argv includes `wrap`.
 */
export async function findWrapPids(): Promise<number[]> {
  const self = process.pid;
  const pids: number[] = [];

  if (process.platform === 'win32') {
    try {
      const proc = Bun.spawn(
        [
          'powershell',
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name = 'capa.exe'" | ` +
            `Where-Object { $_.CommandLine -match '\\swrap(\\s|$)' -and $_.ProcessId -ne ${self} } | ` +
            `Select-Object -ExpandProperty ProcessId`,
        ],
        { stdout: 'pipe', stderr: 'ignore' },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      for (const line of out.split(/\r?\n/)) {
        const n = parseInt(line.trim(), 10);
        if (Number.isFinite(n) && n > 0) pids.push(n);
      }
    } catch {
      // ignore
    }
    return [...new Set(pids)];
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
      // e.g. `capa wrap cursor`, `./dist/capa wrap …`, `bun src/cli/index.ts wrap …`
      if (!/\bwrap\b/.test(cmd)) continue;
      if (!/\bcapa(?:\.exe)?\b/i.test(cmd) && !/src\/cli\/index\.ts\b/.test(cmd)) continue;
      pids.push(pid);
    }
  } catch {
    // ignore
  }
  return [...new Set(pids)];
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
