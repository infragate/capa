import { existsSync, lstatSync, realpathSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { getProvider, resolveProviderId } from "./providers";

/**
 * Relative project paths that `capa install` may write (skills, rules, MCP,
 * hooks, subagents, instruction files, plugin manifests).
 */
export function collectProviderInstallRelativePaths(
	providerIds: Iterable<string>,
): string[] {
	const paths = new Set<string>();
	for (const raw of providerIds) {
		const id = resolveProviderId(raw) ?? raw.trim().toLowerCase();
		const p = getProvider(id);
		if (!p) continue;
		if (p.skillsDir) paths.add(p.skillsDir.replace(/\\/g, "/"));
		if (p.instructions?.filename) {
			paths.add(p.instructions.filename.replace(/\\/g, "/"));
		}
		if (p.mcp?.configPath) paths.add(p.mcp.configPath.replace(/\\/g, "/"));
		if (p.mcp?.defaultMcpFallbackPath) {
			paths.add(p.mcp.defaultMcpFallbackPath.replace(/\\/g, "/"));
		}
		if (p.rules?.dir) paths.add(p.rules.dir.replace(/\\/g, "/"));
		if (p.subagents?.dir) paths.add(p.subagents.dir.replace(/\\/g, "/"));
		if (p.hooks?.storage) {
			const storage = p.hooks.storage;
			if (storage.kind === "directory") {
				paths.add(storage.dir.replace(/\\/g, "/"));
			} else if ("configPath" in storage) {
				paths.add(storage.configPath.replace(/\\/g, "/"));
			}
		}
		for (const manifest of p.pluginManifestPaths ?? []) {
			paths.add(manifest.replace(/\\/g, "/"));
		}
	}
	return [...paths];
}

function formatRel(projectRoot: string, absPath: string): string {
	const root = resolve(projectRoot);
	const rel = relative(root, absPath);
	return rel.split(sep).join("/") || ".";
}

/** Relative path from the real project root — stable across /var vs /private/var. */
function relativeFromProjectReal(projectRoot: string, absPath: string): string {
	const rootReal = realpathSync(resolve(projectRoot));
	const pathReal = realpathSync(absPath);
	const rel = relative(rootReal, pathReal);
	if (rel.startsWith("..") || rel === "") {
		throw new Error(
			`Refusing to install outside the project root: ${formatRel(projectRoot, absPath)}`,
		);
	}
	return rel.split(sep).join("/");
}

/**
 * Ensure `destPath` sits under `projectRoot` and no existing path component
 * on the way is a symlink. Symlinks can redirect capa writes outside the
 * logical provider tree (e.g. `.cursor/skills` → `../skills`).
 */
export function assertCapaOwnedInstallPath(
	projectRoot: string,
	destPath: string,
): void {
	const root = resolve(projectRoot);
	const dest = resolve(destPath);
	const rel = relative(root, dest);
	if (rel.startsWith("..") || rel === "") {
		throw new Error(
			`Refusing to install outside the project root: ${formatRel(root, dest)}`,
		);
	}

	const parts = rel.split(/[/\\]/).filter(Boolean);
	let current = root;
	for (const part of parts) {
		current = join(current, part);
		if (!existsSync(current)) break;

		let st;
		try {
			st = lstatSync(current);
		} catch {
			break;
		}

		if (st.isSymbolicLink()) {
			let targetHint = "";
			try {
				targetHint = ` (resolves to ${relativeFromProjectReal(root, current)})`;
			} catch {
				// dangling link
			}
			throw new Error(
				`Refusing to install through symlink at "${formatRel(root, current)}"${targetHint}. ` +
					`capa can only write to paths it owns directly.`,
			);
		}

		try {
			const relViaLogical = formatRel(root, current);
			const relViaReal = relativeFromProjectReal(root, current);
			if (relViaLogical !== relViaReal) {
				throw new Error(
					`Refusing to install: "${relViaLogical}" resolves through a symlink to "${relViaReal}". ` +
						`capa can only write to paths it owns directly.`,
				);
			}
		} catch (err: unknown) {
			if (err instanceof Error && err.message.startsWith("Refusing to install")) {
				throw err;
			}
			// realpath failure on race — parent symlink check above is enough.
		}
	}
}

/** Validate every provider install root before a full install run. */
export function validateProviderInstallRoots(
	projectRoot: string,
	providerIds: Iterable<string>,
): void {
	for (const rel of collectProviderInstallRelativePaths(providerIds)) {
		assertCapaOwnedInstallPath(projectRoot, join(projectRoot, rel));
	}
}
