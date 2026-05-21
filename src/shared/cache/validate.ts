import { join, resolve, sep } from 'path';
import { getCacheDir } from './paths';

/** Reject user-controlled repo paths before filesystem or shell use. */
export function validateRepoPath(path: string): void {
  if (!path || /[\x00-\x1f]/.test(path)) {
    throw new Error(`Invalid repository path: ${path}`);
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    throw new Error(`Invalid repository path: ${path}`);
  }
  const cacheRoot = join(getCacheDir(), 'git');
  const resolved = resolve(cacheRoot, path);
  const rootWithSep = cacheRoot.endsWith(sep) ? cacheRoot : cacheRoot + sep;
  if (resolved !== cacheRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Invalid repository path: ${path}`);
  }
}
