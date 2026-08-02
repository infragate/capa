import {
	type Dirent,
	closeSync,
	constants as fsConstants,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	realpathSync,
	writeSync,
} from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { assertSafeRepoPath } from "../shared/repo-file";

export interface ProjectFsEntry {
	name: string;
	type: "file" | "dir";
	path: string;
}

function normalizeRel(rel: string): string {
	return rel.split(/[/\\]/).filter(Boolean).join("/");
}

/**
 * Write a file without a check-then-act race (CodeQL js/file-system-race).
 * Uses O_NOFOLLOW on Unix so a symlink cannot be swapped in for the path.
 */
function writeFileNoSymlink(filePath: string, data: Uint8Array): void {
	let fd: number;
	try {
		if (process.platform === "win32") {
			// Bun/Node on Windows reject numeric O_* flag combos with EINVAL;
			// string mode is the supported path and still avoids TOCTOU checks.
			fd = openSync(filePath, "w");
		} else {
			const noFollow =
				typeof fsConstants.O_NOFOLLOW === "number"
					? fsConstants.O_NOFOLLOW
					: 0;
			fd = openSync(
				filePath,
				fsConstants.O_WRONLY |
					fsConstants.O_CREAT |
					fsConstants.O_TRUNC |
					noFollow,
			);
		}
	} catch (err: unknown) {
		const code =
			err && typeof err === "object" && "code" in err
				? String((err as { code: unknown }).code)
				: "";
		if (code === "ELOOP" || code === "EMLINK") {
			throw new Error("Refusing to write through symlink");
		}
		throw err;
	}
	try {
		writeSync(fd, data);
	} finally {
		closeSync(fd);
	}
}

/**
 * Resolve a project-relative path safely (no escape from project root).
 * Empty `rel` returns the project root itself.
 */
export function resolveInsideProject(projectRoot: string, rel = ""): string {
	const root = resolve(projectRoot);
	const cleaned = normalizeRel(rel);
	if (!cleaned) return root;
	return assertSafeRepoPath(root, cleaned);
}

export function toProjectRelative(
	projectRoot: string,
	absolutePath: string,
): string {
	// Prefer realpath so macOS `/var` vs `/private/var` (and other symlink
	// roots) do not look like escapes after mkdirInsideProject canonicalizes.
	let root = resolve(projectRoot);
	let abs = resolve(absolutePath);
	try {
		if (existsSync(root)) root = realpathSync(root);
	} catch {
		/* keep resolve() */
	}
	try {
		if (existsSync(abs)) abs = realpathSync(abs);
	} catch {
		/* keep resolve() */
	}
	const rel = relative(root, abs);
	if (rel.startsWith("..") || rel === "") {
		// '' means the root itself
		if (abs === root) return "";
		throw new Error("Path escapes project root");
	}
	return normalizeRel(rel);
}

function assertRealPathInside(projectRoot: string, absPath: string): string {
	const rootReal = realpathSync(resolve(projectRoot));
	const real = realpathSync(absPath);
	const rootWithSep = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
	if (real !== rootReal && !real.startsWith(rootWithSep)) {
		throw new Error("Path escapes project root via symlink");
	}
	return real;
}

/**
 * Create directories under the project root without following symlinks that escape.
 * Each existing path component must be a real directory (not a symlink).
 */
export function mkdirInsideProject(
	projectRoot: string,
	relDir: string,
): string {
	const rootReal = realpathSync(resolve(projectRoot));
	const segments = normalizeRel(relDir).split("/").filter(Boolean);
	let abs = rootReal;
	for (const seg of segments) {
		if (seg === "." || seg === "..") {
			throw new Error(`Invalid path segment: ${seg}`);
		}
		const next = join(abs, seg);
		if (existsSync(next)) {
			const st = lstatSync(next);
			if (st.isSymbolicLink()) {
				throw new Error(`Refusing to follow symlink at "${seg}"`);
			}
			if (!st.isDirectory()) {
				throw new Error(`Not a directory: ${seg}`);
			}
			abs = next;
		} else {
			mkdirSync(next);
			abs = next;
		}
	}
	return assertRealPathInside(projectRoot, abs);
}

/**
 * List directory entries under a project-relative path.
 * `ext` filters files by extension (e.g. `md`); directories always included.
 * `dirsOnly` returns only directories (for picking skill folders).
 */
export function listProjectFs(
	projectRoot: string,
	relPath = "",
	opts: { ext?: string; dirsOnly?: boolean } = {},
): { path: string; entries: ProjectFsEntry[] } {
	const abs = resolveInsideProject(projectRoot, relPath);
	if (!existsSync(abs)) {
		throw new Error(`Path not found: ${relPath || "."}`);
	}
	let dirents: Dirent[];
	try {
		dirents = readdirSync(abs, { withFileTypes: true });
	} catch {
		throw new Error(`Not a directory: ${relPath || "."}`);
	}

	const ext = opts.ext?.replace(/^\./, "").toLowerCase();
	const entries: ProjectFsEntry[] = [];
	for (const d of dirents) {
		if (d.name.startsWith(".")) continue;
		const childAbs = join(abs, d.name);
		const childRel = toProjectRelative(projectRoot, childAbs);
		if (d.isDirectory()) {
			entries.push({ name: d.name, type: "dir", path: childRel });
			continue;
		}
		if (opts.dirsOnly) continue;
		if (d.isFile()) {
			if (ext) {
				const dot = d.name.lastIndexOf(".");
				const fileExt = dot >= 0 ? d.name.slice(dot + 1).toLowerCase() : "";
				if (fileExt !== ext) continue;
			}
			entries.push({ name: d.name, type: "file", path: childRel });
		}
	}

	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return { path: normalizeRel(relPath), entries };
}

/**
 * Write an uploaded file under `.capa/imports/<safeName>` (or a subpath).
 * Returns the project-relative path of the written file.
 */
export function writeProjectImport(
	projectRoot: string,
	opts: {
		filename: string;
		bytes: Uint8Array;
		/** Optional subdirectory under .capa/imports */
		subdir?: string;
		/** When true, write as a skill directory with SKILL.md */
		asSkillDir?: boolean;
	},
): { path: string } {
	const safeName = basename(opts.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
	if (!safeName || safeName === "." || safeName === "..") {
		throw new Error("Invalid filename");
	}
	if (opts.subdir) {
		const subSegments = normalizeRel(opts.subdir).split("/");
		if (subSegments.some((s) => s === ".." || s === ".")) {
			throw new Error("Invalid subdirectory");
		}
	}

	if (opts.asSkillDir) {
		const id = safeName.replace(/\.md$/i, "") || "skill";
		const skillDirRel = normalizeRel(
			join(".capa/imports", opts.subdir ?? "", id),
		);
		const skillDirAbs = mkdirInsideProject(projectRoot, skillDirRel);
		const skillMd = join(skillDirAbs, "SKILL.md");
		writeFileNoSymlink(skillMd, opts.bytes);
		return { path: toProjectRelative(projectRoot, skillDirAbs) };
	}

	const targetRel = normalizeRel(
		join(".capa/imports", opts.subdir ?? "", safeName),
	);
	const parentAbs = mkdirInsideProject(projectRoot, dirname(targetRel));
	const targetAbs = join(parentAbs, basename(targetRel));
	writeFileNoSymlink(targetAbs, opts.bytes);
	return { path: toProjectRelative(projectRoot, targetAbs) };
}

/** Ensure a candidate skill path points at a directory that contains SKILL.md (or is SKILL.md itself → parent). */
export function normalizeLocalSkillPath(
	projectRoot: string,
	relPath: string,
): string {
	const abs = resolveInsideProject(projectRoot, relPath);
	const base = basename(abs);
	if (base.toLowerCase() === "skill.md") {
		return toProjectRelative(projectRoot, dirname(abs));
	}
	const skillMd = join(abs, "SKILL.md");
	if (!existsSync(skillMd)) {
		throw new Error(
			`Local skill path must be a directory containing SKILL.md (got "${relPath}")`,
		);
	}
	return toProjectRelative(projectRoot, abs);
}
