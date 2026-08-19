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
import { git } from "./git-cli";
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
	return `https://${platform}.com/${repoPath}.git`;
}

/** Strip userinfo from an http(s) URL. Returns null when there is none or the value is not an http(s) URL. */
function stripUserinfoFromHttpUrl(raw: string): string | null {
	const trimmed = raw.trim().replace(/^["']|["']$/g, "");
	try {
		const u = new URL(trimmed);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		if (!u.username && !u.password) return null;
		u.username = "";
		u.password = "";
		let out = u.toString();
		if (!trimmed.endsWith("/") && out.endsWith("/")) {
			out = out.slice(0, -1);
		}
		return out;
	} catch {
		return null;
	}
}

function stripHttpUrlUserinfo(url: string): string {
	return stripUserinfoFromHttpUrl(url) ?? url;
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
 * Ensure a mirror clone exists for the given repo. If it doesn't, perform a
 * bare clone. If it does, leave it as-is — callers can request a fetch via
 * `fetchMirror()` when they need newer refs.
 *
 * Returns the mirror directory path.
 */
export async function ensureMirrorClone(
	platform: CachePlatform,
	repoPath: string,
	_authFetch: AuthenticatedFetch,
	repoUrl?: string,
): Promise<string> {
	validateRepoPath(repoPath);
	scrubCachedMirrorAuthUrls();
	const mirrorDir = getRepoMirrorDir(platform, repoPath);
	if (existsSync(mirrorDir)) {
		scrubMirrorConfigFile(mirrorDir);
		return mirrorDir;
	}
	mkdirSync(getRepoCacheDir(platform, repoPath), { recursive: true });
	const url = stripHttpUrlUserinfo(
		repoUrl ?? publicHttpsRepoUrl(platform, repoPath),
	);
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
	await git(["clone", "--mirror", "--filter=blob:none", url, mirrorDir]);
	await git(["-C", mirrorDir, "remote", "set-url", "origin", url]);
	return mirrorDir;
}

/**
 * Update an existing mirror clone (`git remote update`). Used when a requested
 * version/ref isn't yet present in the mirror.
 *
 * Git uses the developer's credential helper (GCM / `gh auth` / osxkeychain).
 * CAPA does not inject or persist git tokens.
 */
export async function fetchMirror(
	mirrorDir: string,
	_authFetch?: AuthenticatedFetch,
): Promise<void> {
	scrubCachedMirrorAuthUrls();
	scrubMirrorConfigFile(mirrorDir);
	await git(["-C", mirrorDir, "remote", "update", "--prune"]);
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
 * Resolve a (version|ref|pinned|HEAD) request to a concrete commit SHA against
 * a mirror clone. Will fetch the mirror at most once if the ref is unknown.
 */
export async function resolveRef(
	mirrorDir: string,
	opts: ResolveOptions,
	authFetch?: AuthenticatedFetch,
): Promise<ResolveResult> {
	const { version, ref, pinnedSha } = opts;

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
