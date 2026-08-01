import { existsSync } from "fs";
import { join } from "path";

/** Artifact kinds capa does not install from plugins. */
const SKIP_CHECKS: { kind: string; rel: string }[] = [
	{ kind: "lsp", rel: ".lsp.json" },
	{ kind: "monitors", rel: "monitors" },
	{ kind: "themes", rel: "themes" },
	{ kind: "workflows", rel: "workflows" },
	{ kind: "output-styles", rel: "output-styles" },
	{ kind: "bin", rel: "bin" },
	{ kind: "settings", rel: "settings.json" },
];

/**
 * Detect unsupported plugin artifacts present on disk for warning messages.
 */
export function detectSkippedArtifacts(repoRoot: string): string[] {
	const found: string[] = [];
	for (const { kind, rel } of SKIP_CHECKS) {
		if (existsSync(join(repoRoot, rel))) found.push(kind);
	}
	return found;
}
