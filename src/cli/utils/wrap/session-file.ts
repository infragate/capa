import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

/** Written into each wrap cache root so clean/delete can stop live sessions. */
export const WRAP_SESSION_FILE = 'wrap-session.json';

export interface WrapSessionFile {
  pid: number;
  watchPid?: number;
  realProjectPath: string;
  workspacePath: string;
  startedAt: string;
}

export function wrapSessionPath(cachePath: string): string {
  return join(cachePath, WRAP_SESSION_FILE);
}

export function writeWrapSession(
  cachePath: string,
  session: Omit<WrapSessionFile, 'startedAt'> & { startedAt?: string },
): boolean {
  try {
    const data: WrapSessionFile = {
      pid: session.pid,
      watchPid: session.watchPid,
      realProjectPath: resolve(session.realProjectPath),
      workspacePath: resolve(session.workspacePath),
      startedAt: session.startedAt ?? new Date().toISOString(),
    };
    writeFileSync(wrapSessionPath(cachePath), JSON.stringify(data, null, 2) + '\n');
    return true;
  } catch {
    // Session file is auxiliary for clean/stop discovery; never fail wrap startup.
    return false;
  }
}

export function clearWrapSession(cachePath: string): void {
  const path = wrapSessionPath(cachePath);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

export async function readWrapSession(cachePath: string): Promise<WrapSessionFile | null> {
  const path = wrapSessionPath(cachePath);
  if (!existsSync(path)) return null;
  try {
    const data = (await Bun.file(path).json()) as WrapSessionFile;
    if (!data?.pid || !data?.realProjectPath) return null;
    return data;
  } catch {
    return null;
  }
}

export function pathsEqual(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
