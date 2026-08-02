import { createHash } from "crypto";
import { existsSync, realpathSync } from "fs";
import { basename, relative, resolve, sep } from "path";

/**
 * Resolve to an absolute path, preferring the realpath when the target exists.
 * Avoids macOS `/var` vs `/private/var` (and similar symlink) ID mismatches
 * between `process.cwd()` and paths from `mkdtempSync` / `tmpdir()`.
 */
export function canonicalizePath(projectPath: string): string {
	const absPath = resolve(projectPath);
	try {
		if (existsSync(absPath)) return realpathSync(absPath);
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

/**
 * Get the capabilities file path for a project
 */
export function getCapabilitiesPath(
	projectPath: string,
	format: "json" | "yaml",
): string {
	return resolve(projectPath, `capabilities.${format}`);
}

/**
 * Detect which capabilities file exists in the project.
 * Throws an error if both capabilities.yaml and capabilities.json exist.
 * Returns null if no capabilities file is found.
 *
 * @throws Error if both YAML and JSON capabilities files exist
 */
export async function detectCapabilitiesFile(
	projectPath: string,
): Promise<{ path: string; format: "json" | "yaml" } | null> {
	const jsonPath = getCapabilitiesPath(projectPath, "json");
	const yamlPath = getCapabilitiesPath(projectPath, "yaml");

	const jsonExists = await existsAsync(jsonPath);
	const yamlExists = await existsAsync(yamlPath);

	// Error if both files exist
	if (jsonExists && yamlExists) {
		throw new Error(
			"Both capabilities.yaml and capabilities.json found. Please keep only one capabilities file.",
		);
	}

	// Check for YAML first (default format)
	if (yamlExists) {
		return { path: yamlPath, format: "yaml" };
	}

	// Then check for JSON
	if (jsonExists) {
		return { path: jsonPath, format: "json" };
	}

	return null;
}

async function existsAsync(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}
