import { existsSync, readdirSync, statSync } from "fs";
import { join, posix, relative, win32 } from "path";
import { assertSafeRepoPath } from "../repo-file";
import { isPlainObject } from "./types-helpers";

/**
 * True when a manifest path would escape the plugin root if joined.
 * Rejects absolute paths and `..` segments (same policy as assertSafeRepoPath).
 */
function isUnsafeManifestPath(p: string): boolean {
	if (
		posix.isAbsolute(p) ||
		win32.isAbsolute(p) ||
		/^[a-zA-Z]:/.test(p) ||
		p.startsWith("/") ||
		p.startsWith("\\")
	) {
		return true;
	}
	return p.split(/[\\/]/).some((s) => s === "..");
}

/**
 * Normalize a manifest path field (string | string[]) into relative paths
 * from the plugin root. Leading `./` is stripped for joins.
 * Unsafe paths (`..`, absolute) are dropped.
 */
export function normalizePathField(raw: unknown): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : null;
	if (!list || !list.every((p) => typeof p === "string")) return undefined;
	const out: string[] = [];
	for (const p of list) {
		let s = (p as string).replace(/\\/g, "/");
		if (s.startsWith("./")) s = s.slice(2);
		s = s.replace(/\/+$/, "");
		if (!s || isUnsafeManifestPath(s)) continue;
		out.push(s);
	}
	return out;
}

/**
 * Claude/Cursor semantics: when the manifest key is set it *replaces* the
 * default directory. When unset, use `defaultRel`.
 */
export function resolveComponentPaths(
	record: Record<string, unknown>,
	field: string,
	defaultRel: string,
): string[] {
	const fromManifest = normalizePathField(record[field]);
	if (fromManifest !== undefined) return fromManifest;
	return [defaultRel];
}

/**
 * Collect files under a path (file or directory) matching an extension predicate.
 * Paths returned are relative to `repoRoot` using forward slashes.
 * Paths that escape `repoRoot` are ignored.
 */
export function collectFiles(
	repoRoot: string,
	relativePath: string,
	opts: { extensions?: string[]; recursive?: boolean } = {},
): string[] {
	let full: string;
	try {
		full = assertSafeRepoPath(repoRoot, relativePath);
	} catch {
		return [];
	}
	if (!existsSync(full)) return [];

	const exts = opts.extensions?.map((e) => e.toLowerCase());
	const out: string[] = [];

	function accept(abs: string): void {
		const rel = relative(repoRoot, abs).replace(/\\/g, "/");
		if (!rel || rel.startsWith("..") || isUnsafeManifestPath(rel)) return;
		if (exts) {
			const lower = abs.toLowerCase();
			if (!exts.some((e) => lower.endsWith(e))) return;
		}
		out.push(rel);
	}

	const st = statSync(full);
	if (st.isFile()) {
		accept(full);
		return out;
	}

	function walk(dir: string): void {
		let items;
		try {
			items = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const item of items) {
			const abs = join(dir, item.name);
			if (item.isFile()) accept(abs);
			else if (item.isDirectory() && opts.recursive !== false) walk(abs);
		}
	}
	walk(full);
	return out;
}

export function readManifestRecord(data: unknown): Record<string, unknown> {
	return isPlainObject(data) ? data : {};
}
