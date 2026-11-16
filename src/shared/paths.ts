import { createHash } from "crypto";
import { existsSync, realpathSync } from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import type { CapabilitiesFormat } from "../types/capabilities";
import { logger } from "./logger";

/**
 * Resolve to an absolute path, preferring the realpath when the target exists.
 * Avoids macOS `/var` vs `/private/var` (and similar symlink) ID mismatches
 * between `process.cwd()` and paths from `mkdtempSync` / `tmpdir()`.
 */
export function canonicalizePath(projectPath: string): string {
	const absPath = resolve(projectPath);
	try {
		if (existsSync(absPath)) return realpathSync(absPath);
		let cur = absPath;
		while (true) {
			const parent = dirname(cur);
			if (parent === cur) break;
			if (existsSync(parent)) {
				return join(realpathSync(parent), relative(parent, absPath));
			}
			cur = parent;
		}
	} catch {
		// Fall through to resolve() when realpath fails (dangling link, race, etc.).
	}
	return absPath;
}

/**
 * Generate a project ID from a directory path.
 * Format: {directory-name}-{4-char-hash}
 */
export function generateProjectId(projectPath: string): string {
	const absPath = canonicalizePath(projectPath);
	const dirName = basename(absPath);

	// Create hash of full path
	const hash = createHash("sha256")
		.update(absPath)
		.digest("hex")
		.substring(0, 4);

	// Sanitize directory name for use in URL
	const sanitizedName = dirName
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	return `${sanitizedName}-${hash}`;
}

/**
 * True when `child` is `parent` or a path under it.
 * Uses path.relative so Windows drive-letter case is handled.
 */
export function isPathInside(child: string, parent: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return (
		rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`))
	);
}

/**
 * Strip the trailing 4-char path hash from a project ID.
 * `ontology-builder-a6a5` → `ontology-builder`
 */
export function projectNameFromId(projectId: string): string {
	return projectId.replace(/-[a-f0-9]{4}$/i, "");
}

/** Format preference within a location: toml → yaml → json. */
export const CAPABILITIES_FORMAT_ORDER: readonly CapabilitiesFormat[] = [
	"toml",
	"yaml",
	"json",
] as const;

type LocationSpec = {
	dir: (root: string) => string;
	basenames: Record<CapabilitiesFormat, string>;
};

const CAPABILITIES_LOCATIONS: LocationSpec[] = [
	{
		dir: (root) => root,
		basenames: {
			toml: "capabilities.toml",
			yaml: "capabilities.yaml",
			json: "capabilities.json",
		},
	},
	{
		dir: (root) => join(root, ".config"),
		basenames: {
			toml: "capabilities.toml",
			yaml: "capabilities.yaml",
			json: "capabilities.json",
		},
	},
	{
		dir: (root) => join(root, ".config", "capabilities"),
		basenames: {
			toml: "config.toml",
			yaml: "config.yaml",
			json: "config.json",
		},
	},
];

export type CapabilitiesCandidate = {
	path: string;
	format: CapabilitiesFormat;
};

/**
 * All candidate capabilities paths in discovery order (locations × formats).
 */
export function listCapabilitiesCandidates(
	projectPath: string,
): CapabilitiesCandidate[] {
	const root = resolve(projectPath);
	const out: CapabilitiesCandidate[] = [];
	for (const loc of CAPABILITIES_LOCATIONS) {
		const dir = loc.dir(root);
		for (const format of CAPABILITIES_FORMAT_ORDER) {
			out.push({ path: join(dir, loc.basenames[format]), format });
		}
	}
	return out;
}

/** Existing candidates in discovery order (no warning). */
export function listExistingCapabilitiesCandidatesSync(
	projectPath: string,
): CapabilitiesCandidate[] {
	return listCapabilitiesCandidates(projectPath).filter((c) =>
		existsSync(c.path),
	);
}

/** Warn once per process per conflict signature (joined existing paths). */
const warnedMultipleSignatures = new Set<string>();

function warnIfMultiple(existing: CapabilitiesCandidate[]): void {
	if (existing.length <= 1) return;
	const listed = existing.map((c) => c.path).join(", ");
	if (warnedMultipleSignatures.has(listed)) return;
	warnedMultipleSignatures.add(listed);
	logger.warn(
		`Multiple capabilities files found (${listed}). Using ${existing[0].path}.`,
	);
}

/**
 * Get the capabilities file path for `capa init` writes (always project root).
 */
export function getCapabilitiesPath(
	projectPath: string,
	format: CapabilitiesFormat,
): string {
	return resolve(projectPath, `capabilities.${format}`);
}

/**
 * Detect which capabilities file exists in the project.
 * Prefers toml → yaml → json within each location, then root → `.config/` →
 * `.config/capabilities/`. Warns when multiple candidates exist; does not throw.
 * Returns null if no capabilities file is found.
 */
export async function detectCapabilitiesFile(
	projectPath: string,
): Promise<CapabilitiesCandidate | null> {
	const candidates = listCapabilitiesCandidates(projectPath);
	const existing: CapabilitiesCandidate[] = [];
	for (const c of candidates) {
		if (await existsAsync(c.path)) existing.push(c);
	}
	if (existing.length === 0) return null;
	warnIfMultiple(existing);
	return existing[0];
}

async function existsAsync(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}
