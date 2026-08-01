import { existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { isPlainObject } from "./types-helpers";

/**
 * Normalize a manifest path field (string | string[]) into relative paths
 * from the plugin root. Leading `./` is stripped for joins.
 */
export function normalizePathField(raw: unknown): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : null;
	if (!list || !list.every((p) => typeof p === "string")) return undefined;
	return list.map((p) => {
		let s = (p as string).replace(/\\/g, "/");
		if (s.startsWith("./")) s = s.slice(2);
		return s.replace(/\/+$/, "");
	});
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
 */
export function collectFiles(
	repoRoot: string,
	relativePath: string,
	opts: { extensions?: string[]; recursive?: boolean } = {},
): string[] {
	const full = join(repoRoot, relativePath);
	if (!existsSync(full)) return [];

	const exts = opts.extensions?.map((e) => e.toLowerCase());
	const out: string[] = [];

	function accept(abs: string): void {
		const rel = relative(repoRoot, abs).replace(/\\/g, "/");
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
