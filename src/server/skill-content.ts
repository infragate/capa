/**
 * Resolve and read a skill's SKILL.md for a project.
 * Used by the project-detail API for frontmatter descriptions and the skill content endpoint.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { isAbsolute, join, relative } from "path";
import {
	findSkillsInDirectory,
	readSkillFromDirectory,
} from "../cli/commands/install-tasks/helpers/skill-discovery";
import type { AuthenticatedFetch } from "../shared/authenticated-fetch";
import { type CachePlatform, getOrCreateSnapshot } from "../shared/cache";
import { getProvider } from "../shared/providers";
import { assertSafeRepoPath } from "../shared/repo-file";
import { parseRepoString } from "../shared/repo-string";
import { fetchPublicHttpsText } from "../shared/safe-remote-url";
import { parseSkillMd, type SkillMetadata } from "../shared/skill-md";
import type { Capabilities, Skill } from "../types/capabilities";
import type { ResolvedPluginInfo } from "../types/plugin";

export interface SkillContentResult {
	content: string;
	metadata: SkillMetadata;
	files: string[];
}

function stripSurroundingQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function toPosixPath(path: string): string {
	return path.replace(/\\/g, "/");
}

function collectFiles(rootPath: string): string[] {
	const files: string[] = [];

	function visit(currentPath: string) {
		for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
			const fullPath = join(currentPath, entry.name);
			if (entry.isDirectory()) {
				visit(fullPath);
			} else if (entry.isFile()) {
				files.push(toPosixPath(relative(rootPath, fullPath)));
			}
		}
	}

	try {
		const stat = statSync(rootPath);
		if (stat.isFile()) return [rootPath.split(/[\\/]/).pop() || "SKILL.md"];
		if (stat.isDirectory()) visit(rootPath);
	} catch {
		return [];
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function tryParse(
	content: string,
	files: string[] = ["SKILL.md"],
): SkillContentResult | null {
	try {
		const { metadata } = parseSkillMd(content);
		if (metadata.description) {
			metadata.description = stripSurroundingQuotes(
				String(metadata.description),
			).trim();
		}
		return { content, metadata, files };
	} catch {
		// Malformed frontmatter — still return raw content for display
		return { content, metadata: { name: "" }, files };
	}
}

/**
 * Build a browser URL for a github/gitlab repo-string reference.
 * Exact-path refs deep-link into the tree; search-form refs link to the repo root.
 */
function buildBrowseUrl(
	platform: "github" | "gitlab",
	repo: string,
): string | null {
	try {
		const parsed = parseRepoString(repo);
		const ref = parsed.sha ?? parsed.version ?? "main";
		if (parsed.mode === "exact") {
			return platform === "github"
				? `https://github.com/${parsed.ownerRepo}/tree/${ref}/${parsed.target}`
				: `https://gitlab.com/${parsed.ownerRepo}/-/tree/${ref}/${parsed.target}`;
		}
		return platform === "github"
			? `https://github.com/${parsed.ownerRepo}`
			: `https://gitlab.com/${parsed.ownerRepo}`;
	} catch {
		return null;
	}
}

function pluginRepository(
	skill: Skill,
	resolvedPlugins: ResolvedPluginInfo[] | undefined,
): string | null {
	if (!skill.sourcePlugin) return null;
	const plugin = (resolvedPlugins ?? []).find(
		(p) =>
			p.id === skill.sourcePlugin!.id || p.name === skill.sourcePlugin!.name,
	);
	return plugin?.repository || null;
}

/**
 * Resolve an external origin URL for a skill (github / gitlab / remote / plugin).
 * Returns null for local / inline / installed skills with no external source.
 */
export function resolveSkillSourceUrl(
	skill: Skill,
	resolvedPlugins?: ResolvedPluginInfo[],
): string | null {
	if (skill.type === "remote" && skill.def?.url) {
		return skill.def.url;
	}
	if (skill.type === "github" && skill.def?.repo) {
		return buildBrowseUrl("github", skill.def.repo);
	}
	if (skill.type === "gitlab" && skill.def?.repo) {
		return buildBrowseUrl("gitlab", skill.def.repo);
	}
	if (skill.type === "plugin" || skill.sourcePlugin) {
		return pluginRepository(skill, resolvedPlugins);
	}
	return null;
}

/**
 * Resolve SKILL.md content for a skill from inline content, a local path,
 * or an installed copy under a provider's skillsDir.
 */
export function resolveSkillContent(
	projectPath: string,
	skill: Skill,
	providers: string[],
): SkillContentResult | null {
	// Inline skills embed SKILL.md in def.content
	if (skill.type === "inline" && skill.def?.content) {
		return tryParse(skill.def.content, ["SKILL.md"]);
	}

	// Local skills point at a directory (or file) containing SKILL.md
	if (skill.type === "local" && skill.def?.path) {
		const base = isAbsolute(skill.def.path)
			? skill.def.path
			: join(projectPath, skill.def.path);
		const isSkillFile = base.toLowerCase().endsWith("skill.md");
		const skillMdPath = isSkillFile ? base : join(base, "SKILL.md");
		if (existsSync(skillMdPath)) {
			try {
				const files = collectFiles(isSkillFile ? skillMdPath : base);
				return tryParse(readFileSync(skillMdPath, "utf-8"), files);
			} catch {
				return null;
			}
		}
	}

	// Installed / github / gitlab / remote / plugin: look under provider skillsDirs
	for (const pid of providers) {
		const provider = getProvider(pid);
		if (!provider) continue;
		const skillMdPath = join(
			projectPath,
			provider.skillsDir,
			skill.id,
			"SKILL.md",
		);
		if (!existsSync(skillMdPath)) continue;
		try {
			const skillRoot = join(projectPath, provider.skillsDir, skill.id);
			return tryParse(
				readFileSync(skillMdPath, "utf-8"),
				collectFiles(skillRoot),
			);
		} catch {
			// Try next provider
		}
	}

	return null;
}

/**
 * Look up a skill by id in capabilities and resolve its SKILL.md content.
 * Prefer installed/local/inline copies; fall back to fetching remote sources
 * into the shared git cache (or HTTP for remote URLs).
 */
export async function resolveSkillContentById(
	projectPath: string,
	capabilities: Capabilities,
	skillId: string,
	authFetch?: AuthenticatedFetch,
): Promise<SkillContentResult | null> {
	const skill = (capabilities.skills ?? []).find((s) => s.id === skillId);
	if (!skill) return null;
	const providers = capabilities.providers ?? [];
	const local = resolveSkillContent(projectPath, skill, providers);
	if (local) return local;
	if (authFetch) {
		return fetchUninstalledSkillContent(skill, authFetch);
	}
	return null;
}

/**
 * Fetch SKILL.md for an uninstalled github/gitlab/remote skill using the
 * shared git cache (or HTTP for remote URLs). Returns null on failure.
 */
export async function fetchUninstalledSkillContent(
	skill: Skill,
	authFetch: AuthenticatedFetch,
): Promise<SkillContentResult | null> {
	try {
		if (skill.type === "remote" && skill.def?.url) {
			// Do not use AuthenticatedFetch here — arbitrary remote URLs must not
			// inherit git-host credentials (SSRF / credential leak).
			const text = await fetchPublicHttpsText(skill.def.url);
			// Reject HTML login pages
			const trimmed = text.trimStart().slice(0, 200).toLowerCase();
			if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
				return null;
			}
			return tryParse(text, ["SKILL.md"]);
		}

		if (
			(skill.type === "github" || skill.type === "gitlab") &&
			skill.def?.repo
		) {
			const platform = skill.type as CachePlatform;
			const parsed = parseRepoString(skill.def.repo);
			const snapshot = await getOrCreateSnapshot({
				platform,
				repoPath: parsed.ownerRepo,
				authFetch,
				version: skill.def.version ?? parsed.version,
				ref: skill.def.ref ?? parsed.sha,
			});

			let skillMdPath: string | undefined;
			if (parsed.mode === "exact") {
				const skillDir = assertSafeRepoPath(
					snapshot.snapshotDir,
					parsed.target,
				);
				const candidate = join(skillDir, "SKILL.md");
				if (!existsSync(candidate)) return null;
				skillMdPath = candidate;
			} else {
				const found = findSkillsInDirectory(snapshot.snapshotDir);
				const target = parsed.target || skill.id;
				skillMdPath = found.get(target) || found.get(skill.id);
				if (!skillMdPath) return null;
			}

			const skillData = readSkillFromDirectory(skillMdPath);
			const files = [
				"SKILL.md",
				...Array.from(skillData.additionalFiles.keys()).sort(),
			];
			return tryParse(skillData.markdown, files);
		}
	} catch {
		return null;
	}

	return null;
}

/**
 * Get a display description for a skill: capabilities def.description first,
 * then SKILL.md frontmatter description.
 */
export function resolveSkillDescription(
	projectPath: string,
	skill: Skill,
	providers: string[],
): {
	description: string | null;
	descriptionSource: "capabilities" | "frontmatter" | null;
} {
	const fromCaps = skill.def?.description?.trim();
	if (fromCaps) {
		return { description: fromCaps, descriptionSource: "capabilities" };
	}

	const resolved = resolveSkillContent(projectPath, skill, providers);
	const fromFrontmatter = resolved?.metadata?.description?.trim();
	if (fromFrontmatter) {
		return { description: fromFrontmatter, descriptionSource: "frontmatter" };
	}

	return { description: null, descriptionSource: null };
}
