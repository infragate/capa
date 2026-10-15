import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	statSync,
} from "fs";
import { dirname, join, resolve, sep } from "path";

export interface SkillCopyOptions {
	src: string;
	dst: string;
	/** Optional callback invoked for each file copied (for progress / logging). */
	onFile?: (relativePath: string) => void;
	/** Optional max bytes per file (default 50MB). */
	maxFileBytes?: number;
	/**
	 * Symlinks may resolve anywhere inside this directory (default `src`) and
	 * are copied as the files/directories they point to.
	 */
	root?: string;
	/**
	 * When set, a symlink that is broken, points outside `root`, or points at a
	 * directory already copied is skipped and reported here. Without it, a
	 * broken or escaping link throws.
	 */
	onSkippedLink?: (relPath: string, reason: string) => void;
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
	const rootWithSep = rootResolved.endsWith(sep)
		? rootResolved
		: rootResolved + sep;
	if (resolved !== rootResolved && !resolved.startsWith(rootWithSep)) {
		throw new Error(
			`Path "${targetPath}" resolves outside the source directory.`,
		);
	}
}

function resolveSrcRoot(src: string): string {
	return resolve(realpathSync(src));
}

function normalizeRelPath(relPath: string): string {
	return relPath.replace(/\\/g, "/");
}

function checkFileSize(
	size: number,
	maxFileBytes: number,
	relPath: string,
): void {
	if (size > maxFileBytes) {
		throw new Error(
			`File "${relPath}" exceeds the maximum allowed size (${maxFileBytes} bytes).`,
		);
	}
}

interface WalkEntry {
	relPath: string;
	srcPath: string;
	destPath: string;
	realPath: string;
	isDirectory: boolean;
	size: number;
}

interface WalkContext {
	srcRoot: string;
	dstRoot: string;
	maxFileBytes: number;
	/** Symlinks must resolve inside this directory. */
	linkRoot: string;
	/** Real paths of every directory entered so far, across the whole walk. */
	visited: Set<string>;
	/** Symlinks found but not followed yet (see `walkTree`). */
	pendingLinks: string[];
	/** When set, bad links are skipped and reported here instead of throwing. */
	onSkippedLink?: (relPath: string, reason: string) => void;
	visit: (entry: WalkEntry) => void;
}

/**
 * Walk the real tree first, then follow symlinks (including ones found inside
 * linked directories). Each real directory is entered once: a link to a
 * directory already copied is skipped, which stops cycles and the exponential
 * fan-out of links pointing at each other, and a real directory always lands
 * at its own path even when a link to it comes earlier in the listing.
 */
function walkTree(ctx: WalkContext): void {
	walkSkillEntries(ctx, "", false);
	for (let i = 0; i < ctx.pendingLinks.length; i++) {
		walkSkillEntries(ctx, ctx.pendingLinks[i]!, true);
	}
}

function walkSkillEntries(
	ctx: WalkContext,
	relPath: string,
	followLink: boolean,
): void {
	const normalizedRel = normalizeRelPath(relPath);
	const srcPath = normalizedRel ? join(ctx.srcRoot, normalizedRel) : ctx.srcRoot;
	const destPath = normalizedRel ? join(ctx.dstRoot, normalizedRel) : ctx.dstRoot;

	let stat;
	try {
		stat = lstatSync(srcPath);
	} catch (err: any) {
		throw new Error(
			`Failed to read "${normalizedRel || "."}": ${err.message ?? err}`,
		);
	}

	const isLink = stat.isSymbolicLink();
	if (isLink && !followLink) {
		ctx.pendingLinks.push(normalizedRel);
		return;
	}
	let realPath: string;
	try {
		realPath = isLink ? realpathSync(srcPath) : resolve(srcPath);
		assertPathInsideRoot(ctx.linkRoot, realPath);
		// Decide file vs directory by what a symlink points to.
		if (isLink) stat = statSync(realPath);
	} catch (err: any) {
		if (!isLink || !ctx.onSkippedLink) throw err;
		ctx.onSkippedLink(
			normalizedRel,
			err?.code === "ENOENT" ? "broken link" : "points outside the repository",
		);
		return;
	}

	if (stat.isDirectory()) {
		const dirKey = isLink ? realPath : realpathSync(srcPath);
		if (ctx.visited.has(dirKey)) {
			// Only reachable through a link; a plain subdirectory of a linked
			// directory that was already copied is skipped quietly.
			if (isLink) ctx.onSkippedLink?.(normalizedRel, "directory already copied");
			return;
		}
		ctx.visited.add(dirKey);
		ctx.visit({
			relPath: normalizedRel,
			srcPath,
			destPath,
			realPath,
			isDirectory: true,
			size: 0,
		});
		for (const entry of readdirSync(srcPath, { withFileTypes: true })) {
			walkSkillEntries(
				ctx,
				normalizedRel ? join(normalizedRel, entry.name) : entry.name,
				false,
			);
		}
		return;
	}

	if (!stat.isFile()) {
		return;
	}

	checkFileSize(
		stat.size,
		ctx.maxFileBytes,
		normalizedRel || basenameOf(srcPath),
	);

	ctx.visit({
		relPath: normalizedRel,
		srcPath,
		destPath,
		realPath,
		isDirectory: false,
		size: stat.size,
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
	visitor: (ctx: {
		relPath: string;
		srcPath: string;
		realPath: string;
	}) => void,
	opts?: { maxFileBytes?: number },
): void {
	const srcRoot = resolveSrcRoot(src);
	walkTree({
		srcRoot,
		dstRoot: srcRoot,
		maxFileBytes: opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
		linkRoot: srcRoot,
		visited: new Set(),
		pendingLinks: [],
		visit: (entry) => {
			if (!entry.isDirectory) {
				visitor({
					relPath: entry.relPath,
					srcPath: entry.srcPath,
					realPath: entry.realPath,
				});
			}
		},
	});
}

/**
 * Recursively copy files from `src` to `dst`, rejecting any path that
 * resolves (via symlink) outside `root` (default `src`). Used by `capa install` (skill
 * payloads) and `capa add` (plugin payloads).
 */
export function copySkillTree(opts: SkillCopyOptions): { filesCopied: number } {
	const srcRoot = resolveSrcRoot(opts.src);
	const dstRoot = resolve(opts.dst);
	mkdirSync(dstRoot, { recursive: true });

	let filesCopied = 0;
	const visit = (entry: WalkEntry) => {
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
	};

	walkTree({
		srcRoot,
		dstRoot,
		maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
		linkRoot: opts.root ? resolveSrcRoot(opts.root) : srcRoot,
		visited: new Set(),
		pendingLinks: [],
		onSkippedLink: opts.onSkippedLink,
		visit,
	});

	return { filesCopied };
}
