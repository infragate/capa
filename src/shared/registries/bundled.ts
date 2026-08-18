import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

export const BUNDLED_ADAPTER_SLUGS = [
	"skills-sh",
	"claude-plugins",
	"cursor-marketplace",
] as const;

export type BundledAdapterSlug = (typeof BUNDLED_ADAPTER_SLUGS)[number];

/**
 * SHA-256 of the LF-normalized adapter source compiled into this binary.
 * Seed and refresh compare on-disk / vendored bytes against these pins and
 * refuse to load a mutated tree.
 */
export const BUNDLED_ADAPTER_PINS: Record<BundledAdapterSlug, string> = {
	"skills-sh":
		"4f6b1c7ad0f0ab5a13edb673397602faf073736b86030a9755ab1a0fc87b7a08",
	"claude-plugins":
		"075345f00a90ca325032dc9c6910f0d758cf4936e7abe40e160aae9190dbfc49",
	"cursor-marketplace":
		"93fb72fc4c66381f28e7893e9af6b54f270d1fdfdab318838121e802967c0dfd",
};

const BUNDLED_ADAPTER_FILES: Record<BundledAdapterSlug, string> = {
	"skills-sh": join(import.meta.dir, "../../../registries/skills-sh/adapter.ts"),
	"claude-plugins": join(
		import.meta.dir,
		"../../../registries/claude-plugins/adapter.ts",
	),
	"cursor-marketplace": join(
		import.meta.dir,
		"../../../registries/cursor-marketplace/adapter.ts",
	),
};

export function isBundledAdapterSlug(slug: string): slug is BundledAdapterSlug {
	return (BUNDLED_ADAPTER_SLUGS as readonly string[]).includes(slug);
}

export function bundledSource(slug: BundledAdapterSlug): string {
	return `bundled:${slug}`;
}

/** Normalize adapter text so Windows checkouts hash the same as the compiled pin. */
export function normalizeAdapterSource(content: string): string {
	return content.replace(/\r\n/g, "\n");
}

function sha256Utf8(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

export function readBundledAdapterSource(slug: BundledAdapterSlug): string {
	const file = BUNDLED_ADAPTER_FILES[slug];
	return normalizeAdapterSource(readFileSync(file, "utf-8"));
}

export function bundledAdapterPin(slug: BundledAdapterSlug): string {
	return BUNDLED_ADAPTER_PINS[slug];
}

export function assertBundledAdapterPin(
	slug: BundledAdapterSlug,
	content: string,
): void {
	const expected = bundledAdapterPin(slug);
	const actual = sha256Utf8(normalizeAdapterSource(content));
	if (actual !== expected) {
		throw new Error(
			`Bundled adapter hash mismatch for ${slug}: expected ${expected}, got ${actual}`,
		);
	}
}

export function bundledSlugFromSource(source: string): BundledAdapterSlug | null {
	if (source.startsWith("bundled:")) {
		const slug = source.slice("bundled:".length);
		return isBundledAdapterSlug(slug) ? slug : null;
	}
	for (const slug of BUNDLED_ADAPTER_SLUGS) {
		if (source === `infragate/capa@${slug}`) return slug;
	}
	return null;
}

/**
 * First-party seeds install from compiled adapter bytes, never from GitHub.
 * Legacy rows stored as `github` + `infragate/capa@<slug>` are still treated
 * as bundled so `capa registry refresh` cannot pull a mutated remote tree.
 */
export function isBundledRegistryInstall(input: {
	slug: string;
	type: string;
	source: string;
}): input is { slug: BundledAdapterSlug; type: string; source: string } {
	const fromSource = bundledSlugFromSource(input.source);
	return fromSource !== null && fromSource === input.slug;
}
