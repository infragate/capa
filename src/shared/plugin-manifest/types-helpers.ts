import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { UnifiedSkillEntry } from "../../types/plugin";
import { asOptionalString, splitMarkdownFrontmatter } from "./frontmatter";

export interface ParsedMcpServerEntry {
	url?: string;
	command?: string;
	cmd?: string;
	args?: string[];
	env?: Record<string, string>;
	type?: string;
	headers?: Record<string, string>;
	oauth2?: unknown;
	oauth?: unknown;
	auth?: unknown;
}

export function isPlainObject(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function asParsedMcpServerEntry(
	entry: unknown,
): ParsedMcpServerEntry | null {
	if (!isPlainObject(entry)) return null;
	return entry as ParsedMcpServerEntry;
}

export function parseSkillsRaw(raw: unknown): string | string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw) && raw.every((p) => typeof p === "string")) return raw;
	return undefined;
}

/**
 * Collect skill entries from a path: either one dir with SKILL.md or subdirs with SKILL.md.
 */
export function getSkillEntriesFromPath(
	repoRoot: string,
	relativePath: string,
): UnifiedSkillEntry[] {
	const fullPath = join(repoRoot, relativePath);
	if (!existsSync(fullPath)) return [];

	const entries: UnifiedSkillEntry[] = [];
	const skillMdHere = join(fullPath, "SKILL.md");
	if (existsSync(skillMdHere)) {
		const id = relativePath.split(/[/\\]/).filter(Boolean).pop() || "skill";
		entries.push({ id, relativePath });
		return entries;
	}

	try {
		const items = readdirSync(fullPath, { withFileTypes: true });
		for (const item of items) {
			if (!item.isDirectory()) continue;
			const subPath = join(relativePath, item.name).replace(/\\/g, "/");
			const subSkillMd = join(repoRoot, subPath, "SKILL.md");
			if (existsSync(subSkillMd)) {
				entries.push({ id: item.name, relativePath: subPath });
			}
		}
	} catch {
		// ignore
	}
	return entries;
}

/**
 * Parse skills field (string or array) and return unified skill entries.
 * When no `skills` field is set and `skills/` is empty/missing, fall back to
 * a root-level `SKILL.md` (Claude single-skill plugin layout).
 */
export function parseSkillsField(
	repoRoot: string,
	raw: string | string[] | undefined,
	defaultPath: string,
): UnifiedSkillEntry[] {
	const paths: string[] = [];
	if (raw === undefined || raw === null) {
		paths.push(defaultPath);
	} else if (typeof raw === "string") {
		paths.push(raw.startsWith("./") ? raw : `./${raw}`);
	} else if (Array.isArray(raw)) {
		for (const p of raw) {
			paths.push(typeof p === "string" && p.startsWith("./") ? p : `./${p}`);
		}
	}

	const entries: UnifiedSkillEntry[] = [];
	for (const p of paths) {
		entries.push(...getSkillEntriesFromPath(repoRoot, p));
	}

	if (entries.length === 0 && (raw === undefined || raw === null)) {
		const rootSkill = join(repoRoot, "SKILL.md");
		if (existsSync(rootSkill)) {
			let id = "skill";
			try {
				const content = readFileSync(rootSkill, "utf-8");
				const { frontmatter } = splitMarkdownFrontmatter(content);
				id = asOptionalString(frontmatter?.name) ?? id;
			} catch {
				// keep default id
			}
			entries.push({ id, relativePath: "." });
		}
	}

	return entries;
}
