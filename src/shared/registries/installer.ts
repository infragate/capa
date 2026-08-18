import { createHash } from "crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "fs";
import { basename, join } from "path";
import type { RegistrySourceType } from "../../types/database";
import type { RegistryAdapter, RegistryManifest } from "../../types/registry";
import type { AuthenticatedFetch } from "../authenticated-fetch";
import { type CachePlatform, getOrCreateSnapshot } from "../cache";
import { getManagedRegistriesDir } from "../config";
import { getGitProvider } from "../git-providers/registry";
import { assertSafeRepoPath } from "../repo-file";
import { parseRepoString } from "../repo-string";
import { assertPublicHttpsUrl } from "../safe-remote-url";
import {
	fetchClaudeMarketplace,
	getInstalledMarketplacePath,
	loadClaudeMarketplaceAdapter,
	MARKETPLACE_JSON_FILENAME,
	MARKETPLACE_META_FILENAME,
	parseClaudeMarketplaceSource,
	marketplaceNameToSlug,
} from "./claude-marketplace";

export { getInstalledMarketplacePath };

const ADAPTER_EXTENSIONS = [".ts", ".js", ".mjs"] as const;
const ADAPTER_BASENAMES = ADAPTER_EXTENSIONS.map((ext) => `adapter${ext}`);

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/i;

export function isValidSlug(slug: string): boolean {
	return SLUG_REGEX.test(slug);
}

export function deriveSlug(source: string, type: RegistrySourceType): string {
	if (type === "claude-marketplace") {
		try {
			const parsed = parseClaudeMarketplaceSource(source);
			if (parsed.kind === "json-url") {
				const base = basename(new URL(parsed.locator).pathname);
				const name = base.replace(/\.json$/i, "") || "marketplace";
				return name === "marketplace" ? "marketplace" : name;
			}
			return basename(parsed.locator);
		} catch {
			return "marketplace";
		}
	}
	if (type === "url") {
		let u: URL;
		try {
			u = new URL(source);
		} catch {
			return "registry";
		}
		const base = basename(u.pathname);
		const dot = base.lastIndexOf(".");
		const name = dot > 0 ? base.slice(0, dot) : base;
		return name || "registry";
	}
	const parsed = parseRepoString(source);
	if (parsed.mode === "search") return parsed.target;
	return basename(parsed.target);
}

export interface RegistryInstallInput {
	slug: string;
	type: RegistrySourceType;
	source: string;
}

export interface RegistryInstallResult {
	resolvedRef: string | null;
	adapterPath: string;
	manifest: RegistryManifest;
	contentSha256: string;
	/** Preferred slug from marketplace.json `name` (claude-marketplace only). */
	preferredSlug?: string;
}

export interface RegistryStageResult {
	resolvedRef: string | null;
	adapterPath: string;
	contentSha256: string;
	content: string;
	preferredSlug?: string;
}

export function hashAdapterContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

export function assertAdapterHash(filePath: string, expectedSha256: string): void {
	const actual = hashAdapterContent(readFileSync(filePath, "utf-8"));
	if (actual !== expectedSha256) {
		throw new Error(
			`Adapter hash mismatch for ${filePath}: expected ${expectedSha256}, got ${actual}`,
		);
	}
}

export function writeStagedAdapter(
	slug: string,
	content: string,
	ext: string,
): { adapterPath: string; contentSha256: string } {
	if (!ext.startsWith(".")) ext = `.${ext}`;
	const dir = join(getManagedRegistriesDir(), slug);
	mkdirSync(dir, { recursive: true });
	const adapterPath = join(dir, `adapter${ext}`);
	writeFileSync(adapterPath, content, "utf-8");
	return { adapterPath, contentSha256: hashAdapterContent(content) };
}

/**
 * Fetch + write adapter bytes. Does not `import()` adapter TypeScript.
 */
export async function stageRegistry(
	input: RegistryInstallInput,
	authFetch: AuthenticatedFetch,
	opts: { noCache?: boolean } = {},
): Promise<RegistryStageResult> {
	if (!isValidSlug(input.slug)) {
		throw new Error(
			`Invalid slug "${input.slug}". Allowed: lowercase letters, digits, and dashes; ` +
				`must start with a letter or digit.`,
		);
	}

	const targetDir = join(getManagedRegistriesDir(), input.slug);

	try {
		if (existsSync(targetDir)) {
			rmSync(targetDir, { recursive: true, force: true });
		}
		mkdirSync(targetDir, { recursive: true });

		if (input.type === "claude-marketplace") {
			return await stageClaudeMarketplace(input, authFetch, targetDir, opts);
		}

		let adapterPath: string;
		let resolvedRef: string | null = null;
		let content: string;

		if (input.type === "github" || input.type === "gitlab") {
			const { adapterFile, resolvedSha } = await fetchAdapterFromRepo(
				input.type,
				input.source,
				authFetch,
				opts,
			);
			const ext = adapterFile.slice(adapterFile.lastIndexOf("."));
			adapterPath = join(targetDir, `adapter${ext}`);
			content = readFileSync(adapterFile, "utf-8");
			writeFileSync(adapterPath, content, "utf-8");
			resolvedRef = resolvedSha;
		} else {
			const fetched = await fetchAdapterFromUrl(input.source, authFetch);
			content = fetched.content;
			adapterPath = join(targetDir, `adapter${fetched.ext}`);
			writeFileSync(adapterPath, content, "utf-8");
		}

		return {
			resolvedRef,
			adapterPath,
			contentSha256: hashAdapterContent(content),
			content,
		};
	} catch (err) {
		try {
			rmSync(targetDir, { recursive: true, force: true });
		} catch {}
		throw err;
	}
}

/**
 * `import()` a previously staged adapter (or build a Claude marketplace adapter
 * from cached JSON). Verifies `expectedSha256` when provided.
 */
export async function executeStagedRegistry(
	slug: string,
	expectedSha256?: string | null,
): Promise<RegistryInstallResult> {
	const marketplacePath = getInstalledMarketplacePath(slug);
	if (marketplacePath) {
		if (expectedSha256) {
			assertAdapterHash(marketplacePath, expectedSha256);
		}
		const adapter = loadClaudeMarketplaceAdapter(slug);
		if (!isValidAdapter(adapter)) {
			throw new Error(
				`Adapter at ${marketplacePath} does not export a valid RegistryAdapter ` +
					`(needs default export with { manifest, search, view }).`,
			);
		}
		return {
			resolvedRef: null,
			adapterPath: marketplacePath,
			manifest: adapter.manifest,
			contentSha256:
				expectedSha256 ??
				hashAdapterContent(readFileSync(marketplacePath, "utf-8")),
		};
	}

	const adapterPath = getInstalledAdapterPath(slug);
	if (!adapterPath) {
		throw new Error(
			`No materialized adapter file for slug "${slug}"; run \`capa registry refresh ${slug}\`.`,
		);
	}
	if (expectedSha256) {
		assertAdapterHash(adapterPath, expectedSha256);
	}
	const adapter = await loadAdapterFile(adapterPath);
	return {
		resolvedRef: null,
		adapterPath,
		manifest: adapter.manifest,
		contentSha256:
			expectedSha256 ?? hashAdapterContent(readFileSync(adapterPath, "utf-8")),
	};
}

/**
 * Stage then execute. Used by CLI `--yes` and first-start seed.
 */
export async function installRegistry(
	input: RegistryInstallInput,
	authFetch: AuthenticatedFetch,
	opts: { noCache?: boolean } = {},
): Promise<RegistryInstallResult> {
	const staged = await stageRegistry(input, authFetch, opts);
	const executed = await executeStagedRegistry(input.slug, staged.contentSha256);
	return {
		...executed,
		resolvedRef: staged.resolvedRef,
		preferredSlug: staged.preferredSlug,
		contentSha256: staged.contentSha256,
	};
}

async function stageClaudeMarketplace(
	input: RegistryInstallInput,
	authFetch: AuthenticatedFetch,
	targetDir: string,
	opts: { noCache?: boolean },
): Promise<RegistryStageResult> {
	const result = await fetchClaudeMarketplace(input.source, authFetch, opts);
	const jsonPath = join(targetDir, MARKETPLACE_JSON_FILENAME);
	const metaPath = join(targetDir, MARKETPLACE_META_FILENAME);
	const content = JSON.stringify(result.catalog.raw, null, 2);
	writeFileSync(jsonPath, content, "utf-8");
	writeFileSync(metaPath, JSON.stringify(result.meta, null, 2), "utf-8");
	return {
		resolvedRef: result.resolvedRef,
		adapterPath: jsonPath,
		contentSha256: hashAdapterContent(content),
		content,
		preferredSlug: result.preferredSlug,
	};
}

/**
 * Returns the raw adapter source (or marketplace JSON) for preview purposes
 * without persisting anything to disk.
 */
export async function fetchAdapterSource(
	input: Pick<RegistryInstallInput, "type" | "source">,
	authFetch: AuthenticatedFetch,
	opts: { noCache?: boolean } = {},
): Promise<{
	content: string;
	resolvedRef: string | null;
	preferredSlug?: string;
	pluginCount?: number;
}> {
	if (input.type === "claude-marketplace") {
		const result = await fetchClaudeMarketplace(input.source, authFetch, opts);
		return {
			content: JSON.stringify(result.catalog.raw, null, 2),
			resolvedRef: result.resolvedRef,
			preferredSlug: result.preferredSlug,
			pluginCount: result.catalog.plugins.length,
		};
	}
	if (input.type === "github" || input.type === "gitlab") {
		const { adapterFile, resolvedSha } = await fetchAdapterFromRepo(
			input.type,
			input.source,
			authFetch,
			opts,
		);
		return {
			content: readFileSync(adapterFile, "utf-8"),
			resolvedRef: resolvedSha,
		};
	}
	const { content } = await fetchAdapterFromUrl(input.source, authFetch);
	return { content, resolvedRef: null };
}

/**
 * Path of the materialized adapter file for a given slug, or null if no
 * adapter has been written yet. Iterates the known extensions in priority
 * order — first match wins. Does not include Claude marketplace catalogs
 * (see `getInstalledMarketplacePath`).
 */
export function getInstalledAdapterPath(slug: string): string | null {
	const dir = join(getManagedRegistriesDir(), slug);
	for (const name of ADAPTER_BASENAMES) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

export function removeInstalledAdapter(slug: string): void {
	const dir = join(getManagedRegistriesDir(), slug);
	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Re-export for callers that need marketplace name → slug without importing
// the whole marketplace module.
export { marketplaceNameToSlug };


async function fetchAdapterFromRepo(
	platform: "github" | "gitlab",
	source: string,
	authFetch: AuthenticatedFetch,
	opts: { noCache?: boolean },
): Promise<{ adapterFile: string; resolvedSha: string }> {
	let parsed;
	try {
		parsed = parseRepoString(source);
	} catch (err: any) {
		throw new Error(
			`Invalid ${platform} source "${source}". Expected "owner/repo@<name>" or ` +
				`"owner/repo::path/to/<name>".\n  ${err.message}`,
		);
	}

	const snapshot = await snapshotForRegistry(
		platform,
		parsed.ownerRepo,
		authFetch,
		{
			version: parsed.version,
			ref: parsed.sha,
			noCache: opts.noCache,
		},
	);

	let candidateDir: string;
	if (parsed.mode === "exact") {
		try {
			candidateDir = assertSafeRepoPath(snapshot.snapshotDir, parsed.target);
		} catch (err: any) {
			throw new Error(
				`${err.message}\n    Repository: ${parsed.ownerRepo}\n    Snapshot:   ${snapshot.resolvedSha.slice(0, 7)}`,
			);
		}
		if (!existsSync(candidateDir)) {
			throw new Error(
				`Directory "${parsed.target}" not found in ${parsed.ownerRepo} at ` +
					`${snapshot.resolvedSha.slice(0, 7)}.`,
			);
		}
	} else {
		const matches = findAdapterDirsByBasename(
			snapshot.snapshotDir,
			parsed.target,
		);
		if (matches.length === 0) {
			throw new Error(
				`No directory named "${parsed.target}" containing an adapter.{ts,js,mjs} file ` +
					`was found in ${parsed.ownerRepo} at ${snapshot.resolvedSha.slice(0, 7)}.\n` +
					`    Tip: Use "${parsed.ownerRepo}::path/to/${parsed.target}" to reference an exact path.`,
			);
		}
		if (matches.length > 1) {
			const sample = matches
				.map((d) => d.slice(snapshot.snapshotDir.length + 1))
				.slice(0, 8)
				.join(", ");
			throw new Error(
				`Ambiguous reference: ${matches.length} directories named "${parsed.target}" with ` +
					`an adapter file exist in ${parsed.ownerRepo}.\n    Matches: ${sample}\n` +
					`    Tip: Use "::<exact-path>" to disambiguate.`,
			);
		}
		candidateDir = matches[0];
	}

	for (const adapterBasename of ADAPTER_BASENAMES) {
		const candidate = join(candidateDir, adapterBasename);
		if (existsSync(candidate)) {
			return { adapterFile: candidate, resolvedSha: snapshot.resolvedSha };
		}
	}

	const relDir = candidateDir.startsWith(snapshot.snapshotDir)
		? candidateDir.slice(snapshot.snapshotDir.length + 1) || "."
		: candidateDir;
	throw new Error(
		`No adapter.{ts,js,mjs} file found in "${relDir}" of ${parsed.ownerRepo} at ` +
			`${snapshot.resolvedSha.slice(0, 7)}.`,
	);
}

function findAdapterDirsByBasename(root: string, wanted: string): string[] {
	const out: string[] = [];
	function walk(dir: string): void {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			if (!entry.isDirectory()) continue;
			const full = join(dir, entry.name);
			if (entry.name === wanted) {
				const hasAdapter = ADAPTER_BASENAMES.some((b) =>
					existsSync(join(full, b)),
				);
				if (hasAdapter) out.push(full);
			}
			walk(full);
		}
	}
	walk(root);
	return out;
}

async function fetchAdapterFromUrl(
	url: string,
	authFetch: AuthenticatedFetch,
): Promise<{ content: string; ext: string }> {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		throw new Error(`Invalid URL "${url}".`);
	}
	const base = basename(u.pathname);
	const dot = base.lastIndexOf(".");
	const ext = dot > 0 ? base.slice(dot) : "";
	if (!(ADAPTER_EXTENSIONS as readonly string[]).includes(ext)) {
		throw new Error(
			`URL must point to an adapter file with .ts, .js, or .mjs extension; got "${base || url}".`,
		);
	}

	await assertPublicHttpsUrl(url);

	let response: Response;
	try {
		response = await authFetch.fetch(url);
	} catch (err: any) {
		throw new Error(`Failed to fetch ${url}: ${err?.message ?? err}`);
	}
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${url}: ${response.status} ${response.statusText}`,
		);
	}
	const content = await response.text();
	if (!content.trim()) {
		throw new Error(`Adapter fetched from ${url} is empty.`);
	}
	return { content, ext };
}

async function snapshotForRegistry(
	platform: CachePlatform,
	repoPath: string,
	authFetch: AuthenticatedFetch,
	opts: { version?: string; ref?: string; noCache?: boolean },
): Promise<{ snapshotDir: string; resolvedSha: string }> {
	const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
	const platformName = getGitProvider(platform)?.displayName ?? platform;
	try {
		return await getOrCreateSnapshot({
			platform,
			repoPath,
			authFetch,
			version: opts.version,
			ref: opts.ref,
			noCache: opts.noCache,
		});
	} catch (err: any) {
		const message: string = err?.stderr || err?.message || "";
		if (
			message.includes("Authentication failed") ||
			message.includes("could not read Username")
		) {
			throw new Error(
				`${platformName} authentication failed for ${repoPath} — token may be expired; ` +
					`run \`capa auth ${platform}.com\` to reconnect.`,
			);
		}
		if (
			message.includes("could not be found") ||
			message.includes("not found") ||
			message.includes("don't have permission")
		) {
			const hint = hasAuth
				? `Check the path, or ensure your ${platformName} token has access.`
				: `Check the path, or connect ${platformName} via \`capa auth ${platform}.com\` if the repo is private.`;
			throw new Error(
				`${platformName} repository not accessible: ${repoPath} — ${hint}`,
			);
		}
		if (
			message.includes("unable to access") ||
			message.includes("Could not resolve host")
		) {
			throw new Error(
				`Network error: cannot reach ${platform}.com — check your internet connection.`,
			);
		}
		throw new Error(
			`Failed to fetch ${repoPath} from ${platformName}: ${message || "Unknown error"}`,
		);
	}
}

async function loadAdapterFile(filePath: string): Promise<RegistryAdapter> {
	const mtime = statSync(filePath).mtimeMs;
	const moduleUrl = `file://${filePath.replace(/\\/g, "/")}?t=${mtime}`;
	let module;
	try {
		module = await import(moduleUrl);
	} catch (err: any) {
		throw new Error(
			`Adapter at ${filePath} failed to import: ${err?.message ?? err}`,
		);
	}
	const adapter: unknown = module.default ?? module;
	if (!isValidAdapter(adapter)) {
		throw new Error(
			`Adapter at ${filePath} does not export a valid RegistryAdapter ` +
				`(needs default export with { manifest, search, view }).`,
		);
	}
	return adapter;
}

function isValidAdapter(obj: unknown): obj is RegistryAdapter {
	if (!obj || typeof obj !== "object") return false;
	const a = obj as Record<string, unknown>;
	if (!a.manifest || typeof a.manifest !== "object") return false;
	const m = a.manifest as Record<string, unknown>;
	return (
		typeof m.id === "string" &&
		m.id.length > 0 &&
		typeof m.name === "string" &&
		m.name.length > 0 &&
		Array.isArray(m.capabilities) &&
		m.capabilities.length > 0 &&
		typeof a.search === "function" &&
		typeof a.view === "function"
	);
}
