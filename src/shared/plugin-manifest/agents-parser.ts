import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import type { UnifiedAgentEntry } from "../../types/plugin";
import {
	asOptionalString,
	asStringArray,
	splitMarkdownFrontmatter,
} from "./frontmatter";
import { collectFiles, resolveComponentPaths } from "./path-field";

/** Frontmatter keys we map into capa SubAgent fields. */
const MAPPED_KEYS = new Set(["name", "description", "skills"]);

/**
 * Parse agent markdown files from default `agents/` or manifest `agents` paths.
 */
export function parseAgentEntries(
	repoRoot: string,
	record: Record<string, unknown>,
	knownSkillIds: Set<string>,
): UnifiedAgentEntry[] {
	const paths = resolveComponentPaths(record, "agents", "agents");
	const files: string[] = [];
	for (const p of paths) {
		files.push(
			...collectFiles(repoRoot, p, {
				extensions: [".md"],
				recursive: true,
			}),
		);
	}

	const entries: UnifiedAgentEntry[] = [];
	const seen = new Set<string>();

	for (const rel of files) {
		const abs = join(repoRoot, rel);
		if (!existsSync(abs)) continue;
		let content: string;
		try {
			content = readFileSync(abs, "utf-8");
		} catch {
			continue;
		}
		const { frontmatter, body } = splitMarkdownFrontmatter(content);
		const fm = frontmatter ?? {};
		const id =
			asOptionalString(fm.name) ??
			basename(rel).replace(/\.md$/i, "") ??
			"agent";
		if (seen.has(id)) continue;
		seen.add(id);

		const droppedFrontmatterKeys = Object.keys(fm).filter(
			(k) => !MAPPED_KEYS.has(k),
		);
		const skillIds = asStringArray(fm.skills).filter((s) =>
			knownSkillIds.has(s),
		);

		entries.push({
			id,
			relativePath: rel,
			description: asOptionalString(fm.description),
			instructions: body,
			skillIds,
			droppedFrontmatterKeys,
		});
	}

	return entries;
}
