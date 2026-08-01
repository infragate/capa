import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import type { UnifiedCommandEntry } from "../../types/plugin";
import { collectFiles, resolveComponentPaths } from "./path-field";

/**
 * Legacy flat slash-command markdown files (`commands/*.md`).
 * Converted to skill trees at merge time.
 */
export function parseCommandEntries(
	repoRoot: string,
	record: Record<string, unknown>,
): UnifiedCommandEntry[] {
	const paths = resolveComponentPaths(record, "commands", "commands");
	const files: string[] = [];
	for (const p of paths) {
		files.push(
			...collectFiles(repoRoot, p, {
				extensions: [".md"],
				recursive: true,
			}),
		);
	}

	const entries: UnifiedCommandEntry[] = [];
	const seen = new Set<string>();
	for (const rel of files) {
		const id = basename(rel).replace(/\.md$/i, "");
		if (!id || seen.has(id)) continue;
		seen.add(id);
		entries.push({ id, relativePath: rel });
	}
	return entries;
}

/**
 * Materialize a command `.md` as `<destDir>/SKILL.md`.
 * Returns false if the source is missing.
 */
export function materializeCommandAsSkill(
	pluginRoot: string,
	entry: UnifiedCommandEntry,
	destSkillDir: string,
): boolean {
	const src = join(pluginRoot, entry.relativePath);
	if (!existsSync(src)) return false;
	let content: string;
	try {
		content = readFileSync(src, "utf-8");
	} catch {
		return false;
	}
	if (!/^---\s*\r?\n/.test(content)) {
		content = `---\nname: ${entry.id}\n---\n\n${content}`;
	} else if (!/^---\s*\r?\n[\s\S]*?\bname\s*:/m.test(content)) {
		content = content.replace(/^---\s*\r?\n/, `---\nname: ${entry.id}\n`);
	}
	mkdirSync(destSkillDir, { recursive: true });
	writeFileSync(join(destSkillDir, "SKILL.md"), content, "utf-8");
	return true;
}

/** List top-level `.md` files in commands/ without parsing a manifest record. */
export function discoverDefaultCommands(repoRoot: string): UnifiedCommandEntry[] {
	const dir = join(repoRoot, "commands");
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".md"))
			.map((d) => ({
				id: d.name.replace(/\.md$/i, ""),
				relativePath: `commands/${d.name}`,
			}));
	} catch {
		return [];
	}
}
