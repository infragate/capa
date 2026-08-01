import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import type { UnifiedRuleEntry } from "../../types/plugin";
import {
	asOptionalBoolean,
	asOptionalString,
	asStringArray,
	splitMarkdownFrontmatter,
} from "./frontmatter";
import { collectFiles, resolveComponentPaths } from "./path-field";

/**
 * Parse Cursor-style rule files (`.mdc` / `.md`) from `rules/` or manifest `rules`.
 */
export function parseRuleEntries(
	repoRoot: string,
	record: Record<string, unknown>,
): UnifiedRuleEntry[] {
	const paths = resolveComponentPaths(record, "rules", "rules");
	const files: string[] = [];
	for (const p of paths) {
		files.push(
			...collectFiles(repoRoot, p, {
				extensions: [".mdc", ".md"],
				recursive: true,
			}),
		);
	}

	const entries: UnifiedRuleEntry[] = [];
	const seen = new Set<string>();

	for (const rel of files) {
		const abs = join(repoRoot, rel);
		if (!existsSync(abs)) continue;
		let raw: string;
		try {
			raw = readFileSync(abs, "utf-8");
		} catch {
			continue;
		}
		const { frontmatter, body } = splitMarkdownFrontmatter(raw);
		const fm = frontmatter ?? {};
		const id = basename(rel).replace(/\.(mdc|md)$/i, "");
		if (!id || seen.has(id)) continue;
		seen.add(id);

		const globs = asStringArray(fm.globs ?? fm.appliesTo ?? fm.paths);
		const appliesTo = globs.length > 0 ? globs : undefined;

		entries.push({
			id,
			relativePath: rel,
			content: body,
			description: asOptionalString(fm.description),
			appliesTo,
			alwaysApply: asOptionalBoolean(fm.alwaysApply ?? fm.always_apply),
		});
	}

	return entries;
}

export function discoverDefaultRules(repoRoot: string): UnifiedRuleEntry[] {
	return parseRuleEntries(repoRoot, {});
}
