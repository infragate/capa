import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "fs";
import { join } from "path";
import type { AuthenticatedFetch } from "../authenticated-fetch";
import {
	isHttpsOrLoopback,
	stripHttpUrlUserinfo,
	stripUserinfoFromHttpUrl,
} from "../git-url";
import { git, gitHttpCredentialEnv } from "./git-cli";
import {
	type CachePlatform,
	getCacheDir,
	getRepoCacheDir,
	getRepoMirrorDir,
} from "./paths";
import { validateRepoPath } from "./validate";

function publicHttpsRepoUrl(
	platform: CachePlatform,
	repoPath: string,
): string {
	validateRepoPath(repoPath);
	if (platform === "git") {
		throw new Error(`A clone URL is required for git repository ${repoPath}`);
	}
	return `https://${platform}.com/${repoPath}.git`;
}

function credentialEnvFor(
	url: string,
	authFetch: AuthenticatedFetch | undefined,
): Record<string, string> | undefined {
	if (!authFetch) return undefined;
	// Never hand a stored token to a cleartext (non-loopback http) remote.
	try {
		if (!isHttpsOrLoopback(new URL(url))) return undefined;
	} catch {
		return undefined;
	}
	if (!authFetch.hasAuth(url)) return undefined;
	const token = authFetch.getTokenForUrl(url);
	if (!token) return undefined;
	return gitHttpCredentialEnv(token);
}

function scrubGitConfigText(text: string): string {
	return text.replace(
		/^([ \t]*(?:push)?url[ \t]*=[ \t]*)(.*)$/gim,
		(full, prefix: string, value: string) => {
			const stripped = stripUserinfoFromHttpUrl(value);
			return stripped ? `${prefix}${stripped}` : full;
		},
	);
}

function scrubMirrorConfigFile(mirrorDir: string): void {
	const configPath = join(mirrorDir, "config");
	try {
		const original = readFileSync(configPath, "utf8");
		const next = scrubGitConfigText(original);
		if (next !== original) {
			writeFileSync(configPath, next);
		}
	} catch {
		// Missing, unreadable, or unwritable configs are left as-is.
	}
}

function walkAndScrubMirrors(
	dir: string,
	depth: number,
	seen: Set<string>,
): void {
	if (depth > 8) return;
	let real: string;
	try {
		real = realpathSync(dir);
	} catch {
		return;
	}
	if (seen.has(real)) return;
	seen.add(real);

	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
		// Snapshot trees are huge materialized checkouts — never walk them.
		if (entry.name === "snapshots") continue;
		const p = join(dir, entry.name);
		if (entry.name === "mirror") {
			scrubMirrorConfigFile(p);
			continue;
		}
		walkAndScrubMirrors(p, depth + 1, seen);
	}
}

const scrubbedGitRoots = new Set<string>();

/** Rewrite cached mirror remotes that still embed oauth2:/userinfo tokens. */
export function scrubCachedMirrorAuthUrls(): void {
	const gitRoot = join(getCacheDir(), "git");
	if (scrubbedGitRoots.has(gitRoot)) return;
	scrubbedGitRoots.add(gitRoot);
	walkAndScrubMirrors(gitRoot, 0, new Set());
}

/**
 * A generic git cache key is derived from the clone URL, so a mirror whose
 * origin is a different URL means the cache was tampered with or keyed by an
 * older capa. Refuse it rather than serve another repository's content.
 */
async function assertMirrorOrigin(mirrorDir: string, url: string): Promise<void> {
	const { stdout } = await git(["-C", mirrorDir, "remote", "get-url", "origin"]);
	if (stdout.trim() !== url) {
		throw new Error(
			`Cached mirror at ${mirrorDir} is for ${stdout.trim()}, not ${url}. ` +
				`Run \`capa cache clean\` and try again.`,
		);
	}
}

/**
 * Ensure a mirror clone exists for the given repo. If it doesn't, perform a
 * bare clone. If it does, leave it as-is — callers can request a fetch via
 * `fetchMirror()` when they need newer refs.
 *
 * Returns the mirror directory path.
 */
export async function ensureMirrorClone(
	platform: CachePlatform,
	repoPath: string,
	authFetch: AuthenticatedFetch | undefined,
	repoUrl?: string,
): Promise<string> {
	validateRepoPath(repoPath);
	scrubCachedMirrorAuthUrls();
	const mirrorDir = getRepoMirrorDir(platform, repoPath);
	if (existsSync(mirrorDir)) {
		scrubMirrorConfigFile(mirrorDir);
		if (platform === "git" && repoUrl) {
			await assertMirrorOrigin(mirrorDir, stripHttpUrlUserinfo(repoUrl));
		}
		return mirrorDir;
	}
	mkdirSync(getRepoCacheDir(platform, repoPath), { recursive: true });
	const url = stripHttpUrlUserinfo(
		repoUrl ?? publicHttpsRepoUrl(platform, repoPath),
	);
	const env = credentialEnvFor(url, authFetch);
	// Blobless partial clone: fetch the full commit/tree graph (so any SHA, tag,
	// or branch still resolves offline via resolveRef) but skip all historical
	// file contents. On a big repo (e.g. remotion) this avoids downloading every
	// blob across all history — the dominant cost. The blobs for the single
	// revision we actually check out are fetched lazily by `git worktree add`
	// during materializeSnapshot, so snapshots stay byte-identical and no consumer
	// (skills/rules/hooks/plugins, `@`-search or `::`-exact) is affected.
	//
	// Why not sparse-checkout per file? Consumers walk whole trees (`@` search)
	// and copy entire skill directories that reference sibling files, so we can't
	// know the full file set up front without risking regressions. Blobless keeps
	// the materialized tree complete while still skipping the expensive history.
	//
	// Requires git >= 2.19. Servers without partial-clone support degrade
	// gracefully to a full clone (git warns and ignores the filter).
	await git(["clone", "--mirror", "--filter=blob:none", "--", url, mirrorDir], {
		env,
	});
	await git(["-C", mirrorDir, "remote", "set-url", "origin", url]);
	return mirrorDir;
}

/**
 * Update an existing mirror clone (`git remote update`). Used when a requested
 * version/ref isn't yet present in the mirror.
 *
 * Credentials are injected per-call via env (never stored in the remote URL).
 */
export async function fetchMirror(
	mirrorDir: string,
	authFetch?: AuthenticatedFetch,
): Promise<void> {
	scrubCachedMirrorAuthUrls();
	scrubMirrorConfigFile(mirrorDir);
	let env: Record<string, string> | undefined;
	if (authFetch) {
		try {
			const { stdout } = await git([
				"-C",
				mirrorDir,
				"remote",
				"get-url",
				"origin",
			]);
			env = credentialEnvFor(stdout.trim(), authFetch);
		} catch {
			// No origin remote — update may still succeed for other remotes.
		}
	}
	await git(["-C", mirrorDir, "remote", "update", "--prune"], { env });
}

/**
 * Check whether the mirror already contains a given commit/tag/branch ref.
 * Returns the resolved full SHA or null if the ref is unknown.
 */
async function tryResolveRefInMirror(
	mirrorDir: string,
	ref: string,
): Promise<string | null> {
	try {
		const { stdout } = await git([
			"-C",
			mirrorDir,
			"rev-parse",
			"--verify",
			`${ref}^{commit}`,
		]);
		const sha = stdout.trim();
		return /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

/**
 * Discover the latest semver tag in a mirror clone. Returns null if there
 * are no version-shaped tags.
 */
async function findLatestVersionTag(mirrorDir: string): Promise<string | null> {
	const { stdout } = await git(["-C", mirrorDir, "tag", "--list"]);
	const tags = stdout.trim().split("\n").filter(Boolean);
	const versionTags = tags.filter((t) => /^v?\d+\.\d+\.\d+$/.test(t));
	if (versionTags.length === 0) return null;
	versionTags.sort((a, b) => {
		const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
		const [aMaj, aMin, aPat] = parse(a);
		const [bMaj, bMin, bPat] = parse(b);
		return bMaj - aMaj || bMin - aMin || bPat - aPat;
	});
	return versionTags[0];
}

export interface ResolveOptions {
	/** Tag/branch requested in the capabilities file (e.g. "v1.2.3"). */
	version?: string;
	/** Commit SHA explicitly requested in the capabilities file. */
	ref?: string;
	/**
	 * Commit SHA already pinned by an existing lockfile entry. When provided we
	 * try to use it without hitting the network.
	 */
	pinnedSha?: string;
}

export interface ResolveResult {
	/** Full 40-char commit SHA. */
	sha: string;
	/** The tag the SHA corresponds to (auto-discovered for unpinned installs), if any. */
	version: string | null;
}

/**
 * Only names git itself accepts as a ref (`git check-ref-format`) or a commit
 * SHA reach `git rev-parse`. That rules out its revision syntax (`HEAD~2`,
 * `main@{1}`, `:/text`, `a..b`) and anything that looks like an option, while
 * monorepo tags such as `@scope/pkg@1.2.3` still work.
 */
const GIT_REF_FORBIDDEN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
	/[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|^[-/.]|\/$|\/\/|\/\.|\.$|\.lock(?:\/|$)|^@$/;

export function assertGitRefName(field: string, value: string | undefined): void {
	if (value && (value.length > 255 || GIT_REF_FORBIDDEN.test(value))) {
		throw new Error(
			`Invalid ${field} "${value}": use a tag, branch or commit SHA (no spaces, ~ ^ : ? * [ \\, "..", "@{", or leading "-").`,
		);
	}
}

/**
 * Resolve a (version|ref|pinned|HEAD) request to a concrete commit SHA against
 * a mirror clone. Will fetch the mirror at most once if the ref is unknown.
 */
export async function resolveRef(
	mirrorDir: string,
	opts: ResolveOptions,
	authFetch?: AuthenticatedFetch,
): Promise<ResolveResult> {
	const { version, ref, pinnedSha } = opts;
	assertGitRefName("version", version);
	assertGitRefName("ref", ref);
	// A lockfile pin is a commit SHA (full, or abbreviated if hand-edited);
	// a branch or tag name there would silently float.
	if (pinnedSha && !/^[0-9a-f]{7,40}$/i.test(pinnedSha)) {
		throw new Error(
			`Invalid pinned commit "${pinnedSha}" in capabilities.lock: expected a commit SHA. Remove the entry or run "capa install --no-cache" to re-pin.`,
		);
	}

	if (pinnedSha) {
		const sha = await tryResolveRefInMirror(mirrorDir, pinnedSha);
		if (sha) return { sha, version: version ?? null };
		await fetchMirror(mirrorDir, authFetch);
		const sha2 = await tryResolveRefInMirror(mirrorDir, pinnedSha);
		if (sha2) return { sha: sha2, version: version ?? null };
		throw new Error(
			`Pinned commit ${pinnedSha} could not be found in repository at ${mirrorDir}`,
		);
	}

	if (ref) {
		const sha = await tryResolveRefInMirror(mirrorDir, ref);
		if (sha) return { sha, version: null };
		await fetchMirror(mirrorDir, authFetch);
		const sha2 = await tryResolveRefInMirror(mirrorDir, ref);
		if (sha2) return { sha: sha2, version: null };
		throw new Error(`Commit ${ref} not found in repository at ${mirrorDir}`);
	}

	if (version) {
		const sha = await tryResolveRefInMirror(mirrorDir, version);
		if (sha) return { sha, version };
		await fetchMirror(mirrorDir, authFetch);
		const sha2 = await tryResolveRefInMirror(mirrorDir, version);
		if (sha2) return { sha: sha2, version };
		throw new Error(
			`Tag/branch "${version}" not found in repository at ${mirrorDir}`,
		);
	}

	// Unpinned: prefer the latest semver tag, fall back to HEAD of default branch.
	const latestTag = await findLatestVersionTag(mirrorDir);
	if (latestTag) {
		const sha = await tryResolveRefInMirror(mirrorDir, latestTag);
		if (sha) return { sha, version: latestTag };
	}
	const headSha = await tryResolveRefInMirror(mirrorDir, "HEAD");
	if (headSha) return { sha: headSha, version: null };
	throw new Error(`Could not resolve HEAD in repository at ${mirrorDir}`);
}
