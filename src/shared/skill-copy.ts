import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'fs';
import { dirname, join, resolve, sep } from 'path';

export interface SkillCopyOptions {
  src: string;
  dst: string;
  /** Optional callback invoked for each file copied (for progress / logging). */
  onFile?: (relativePath: string) => void;
  /** Optional max bytes per file (default 50MB). */
  maxFileBytes?: number;
  /**
   * When set, invoked for each file instead of the default binary copy.
   * Used by plugin install security checks; omit for a verbatim tree copy.
   */
  handleFile?: (ctx: {
    relPath: string;
    srcPath: string;
    destPath: string;
    realPath: string;
  }) => void;
}

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

function assertPathInsideRoot(rootDir: string, targetPath: string): void {
  const rootResolved = resolve(rootDir);
  const resolved = resolve(targetPath);
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (resolved !== rootResolved && !resolved.startsWith(rootWithSep)) {
    throw new Error(
      `Path "${targetPath}" resolves outside the source directory.`
    );
  }
}

function resolveSrcRoot(src: string): string {
  return resolve(realpathSync(src));
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function checkFileSize(size: number, maxFileBytes: number, relPath: string): void {
  if (size > maxFileBytes) {
    throw new Error(
      `File "${relPath}" exceeds the maximum allowed size (${maxFileBytes} bytes).`
    );
  }
}

function walkSkillEntries(
  srcRoot: string,
  dstRoot: string,
  relPath: string,
  maxFileBytes: number,
  visit: (entry: {
    relPath: string;
    srcPath: string;
    destPath: string;
    realPath: string;
    isDirectory: boolean;
    size: number;
  }) => void
): void {
  const normalizedRel = normalizeRelPath(relPath);
  const srcPath = normalizedRel ? join(srcRoot, normalizedRel) : srcRoot;
  const destPath = normalizedRel ? join(dstRoot, normalizedRel) : dstRoot;

  let stat;
  try {
    stat = lstatSync(srcPath);
  } catch (err: any) {
    throw new Error(
      `Failed to read "${normalizedRel || '.'}": ${err.message ?? err}`
    );
  }

  const realPath = stat.isSymbolicLink() ? realpathSync(srcPath) : resolve(srcPath);
  assertPathInsideRoot(srcRoot, realPath);

  if (stat.isDirectory()) {
    visit({
      relPath: normalizedRel,
      srcPath,
      destPath,
      realPath,
      isDirectory: true,
      size: 0,
    });
    for (const entry of readdirSync(srcPath, { withFileTypes: true })) {
      const childRel = normalizedRel
        ? join(normalizedRel, entry.name)
        : entry.name;
      walkSkillEntries(srcRoot, dstRoot, childRel, maxFileBytes, visit);
    }
    return;
  }

  if (!stat.isFile()) {
    return;
  }

  const fileStat = stat.isSymbolicLink() ? statSync(realPath) : stat;
  checkFileSize(fileStat.size, maxFileBytes, normalizedRel || basenameOf(srcPath));

  visit({
    relPath: normalizedRel,
    srcPath,
    destPath,
    realPath,
    isDirectory: false,
    size: fileStat.size,
  });
}

function basenameOf(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? filePath;
}

/**
 * Invoke `visitor` for every file under `src`, rejecting paths that resolve
 * (via symlink) outside `src`. Directories are not passed to the visitor.
 */
export function forEachSkillFile(
  src: string,
  visitor: (ctx: { relPath: string; srcPath: string; realPath: string }) => void,
  opts?: { maxFileBytes?: number }
): void {
  const srcRoot = resolveSrcRoot(src);
  const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  walkSkillEntries(srcRoot, srcRoot, '', maxFileBytes, (entry) => {
    if (!entry.isDirectory) {
      visitor({
        relPath: entry.relPath,
        srcPath: entry.srcPath,
        realPath: entry.realPath,
      });
    }
  });
}

/**
 * Recursively copy files from `src` to `dst`, rejecting any path that
 * resolves (via symlink) outside `src`. Used by `capa install` (skill
 * payloads) and `capa add` (plugin payloads).
 */
export function copySkillTree(opts: SkillCopyOptions): { filesCopied: number } {
  const srcRoot = resolveSrcRoot(opts.src);
  const dstRoot = resolve(opts.dst);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  mkdirSync(dstRoot, { recursive: true });

  let filesCopied = 0;

  walkSkillEntries(srcRoot, dstRoot, '', maxFileBytes, (entry) => {
    if (entry.isDirectory) {
      mkdirSync(entry.destPath, { recursive: true });
      return;
    }

    mkdirSync(dirname(entry.destPath), { recursive: true });
    opts.onFile?.(entry.relPath);

    if (opts.handleFile) {
      opts.handleFile({
        relPath: entry.relPath,
        srcPath: entry.srcPath,
        destPath: entry.destPath,
        realPath: entry.realPath,
      });
    } else {
      copyFileSync(entry.realPath, entry.destPath);
    }
    filesCopied++;
  });

  return { filesCopied };
}
