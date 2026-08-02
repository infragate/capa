import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { getProviderOwnedTopLevelNames } from '../../../shared/providers';

export const CAPA_GITIGNORE_START = '# CAPA START';
export const CAPA_GITIGNORE_END = '# CAPA END';

const isWin = platform() === 'win32';

function linkIntoWorkspace(targetPath: string, linkPath: string): void {
  const targetIsDir = existsSync(targetPath) && statSync(targetPath).isDirectory();
  if (isWin) {
    if (targetIsDir) {
      symlinkSync(targetPath, linkPath, 'junction');
    } else {
      try {
        symlinkSync(targetPath, linkPath, 'file');
      } catch {
        linkSync(targetPath, linkPath);
      }
    }
  } else {
    symlinkSync(targetPath, linkPath);
  }
}

/**
 * Remove the capa-managed block (inclusive of markers). If markers are missing
 * or malformed, the whole text is treated as user base.
 */
export function stripCapaGitignoreBlock(text: string): string {
  const startIdx = text.indexOf(CAPA_GITIGNORE_START);
  if (startIdx === -1) {
    return normalizeUserBase(text);
  }
  const afterStart = startIdx + CAPA_GITIGNORE_START.length;
  const endIdx = text.indexOf(CAPA_GITIGNORE_END, afterStart);
  if (endIdx === -1) {
    return normalizeUserBase(text.slice(0, startIdx));
  }
  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + CAPA_GITIGNORE_END.length);
  return normalizeUserBase(before + after);
}

function normalizeUserBase(text: string): string {
  return text.replace(/(?:\r?\n)+$/u, '').replace(/[ \t]+$/gm, '');
}

/** Sorted unique provider-owned top-level names between CAPA markers. */
export function buildCapaGitignoreBlock(providerIds: Iterable<string>): string {
  const names = [...getProviderOwnedTopLevelNames(providerIds)].sort((a, b) =>
    a.localeCompare(b),
  );
  return [CAPA_GITIGNORE_START, ...names, CAPA_GITIGNORE_END].join('\n');
}

export function composeExcludeFile(
  userBase: string,
  providerIds: Iterable<string>,
): string {
  const base = normalizeUserBase(userBase);
  const block = buildCapaGitignoreBlock(providerIds);
  if (!base) return `${block}\n`;
  return `${base}\n\n${block}\n`;
}

function readTextIfExists(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isSymlinkOrJunction(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function writeIfChanged(path: string, content: string): void {
  const existing = readTextIfExists(path);
  if (existing === content) return;
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/**
 * Ensure the wrap workspace has a selective `.git` layout:
 * each entry under real `.git` is linked, except `info/`, which is a real
 * directory so `info/exclude` can be shadow-local (CAPA block) without
 * mutating the real repo's exclude file.
 *
 * No-ops when the real project has no `.git` directory (or `.git` is a gitfile).
 */
export function ensureWrapGitLayout(
  realProjectPath: string,
  workspacePath: string,
): boolean {
  const realGit = join(resolve(realProjectPath), '.git');
  const wsGit = join(resolve(workspacePath), '.git');

  if (!existsSync(realGit)) return false;

  let realStat;
  try {
    realStat = lstatSync(realGit);
  } catch {
    return false;
  }

  // Worktree / submodule gitfile — keep a simple link; cannot overlay exclude.
  if (realStat.isFile() || realStat.isSymbolicLink()) {
    if (!existsSync(wsGit)) {
      linkIntoWorkspace(realGit, wsGit);
    }
    return false;
  }
  if (!realStat.isDirectory()) return false;

  // Upgrade legacy full-dir junction/symlink to selective layout.
  if (existsSync(wsGit) && isSymlinkOrJunction(wsGit)) {
    rmSync(wsGit, { recursive: true, force: true });
  }
  mkdirSync(wsGit, { recursive: true });

  let entries: string[] = [];
  try {
    entries = readdirSync(realGit);
  } catch {
    return false;
  }

  for (const name of entries) {
    if (name === 'info') continue;
    const target = join(realGit, name);
    const link = join(wsGit, name);
    if (existsSync(link)) continue;
    try {
      linkIntoWorkspace(target, link);
    } catch {
      // best-effort
    }
  }

  const realInfo = join(realGit, 'info');
  const wsInfo = join(wsGit, 'info');
  if (existsSync(wsInfo) && isSymlinkOrJunction(wsInfo)) {
    rmSync(wsInfo, { recursive: true, force: true });
  }
  mkdirSync(wsInfo, { recursive: true });

  if (existsSync(realInfo) && lstatSync(realInfo).isDirectory()) {
    for (const name of readdirSync(realInfo)) {
      if (name === 'exclude') continue;
      const target = join(realInfo, name);
      const link = join(wsInfo, name);
      if (existsSync(link)) continue;
      try {
        linkIntoWorkspace(target, link);
      } catch {
        // best-effort
      }
    }
  }

  return true;
}

/**
 * Seed/refresh wrap-local `.git/info/exclude`:
 * user base from the real exclude (capa strip) + regenerated CAPA block.
 * Requires {@link ensureWrapGitLayout} first for a shadow-local exclude file.
 */
export function syncWrapGitExclude(
  realProjectPath: string,
  workspacePath: string,
  providerIds: Iterable<string>,
): void {
  const ready = ensureWrapGitLayout(realProjectPath, workspacePath);
  if (!ready) return;

  const realExclude = join(resolve(realProjectPath), '.git', 'info', 'exclude');
  const wsExclude = join(resolve(workspacePath), '.git', 'info', 'exclude');

  const rawReal = readTextIfExists(realExclude) ?? '';
  const userBase = stripCapaGitignoreBlock(rawReal);
  writeIfChanged(wsExclude, composeExcludeFile(userBase, providerIds));
}
