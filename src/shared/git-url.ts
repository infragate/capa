/**
 * Generic git sources: any repository reachable by a clone URL, not only
 * github.com or gitlab.com. `capa add` recognizes them by the `.git` suffix.
 *
 *   https://git.example.com/team/skills.git
 *   https://git.example.com/team/skills.git::path/to/skill   exact subpath
 *   https://git.example.com/team/skills.git:v1.2.0           tag or branch
 *   https://git.example.com/team/skills.git#<sha>            commit
 *   ssh://git@git.example.com/team/skills.git                 over SSH
 */

import { createHash } from "crypto";

const GIT_URL_RE =
	/^((?:https?|ssh|file):\/\/.+?\.git)\/?(?:::([^:#]+))?(?::([\w.+/-]+))?(?:#([a-f0-9]{7,40}))?$/i;

export interface GitUrlSource {
	/** Clone URL, without the `::path` / `:version` / `#sha` suffixes. */
	url: string;
	path?: string;
	version?: string;
	ref?: string;
	/** Last segment of the path, or of the URL without `.git`. */
	idHint: string;
}

/** Parse a `.git` clone URL with optional suffixes. null when it is not one. */
export function parseGitUrlSource(source: string): GitUrlSource | null {
	const m = source.trim().match(GIT_URL_RE);
	if (!m) return null;
	const [, url, rawPath, version, ref] = m;
	const path = rawPath?.replace(/^\/+|\/+$/g, "") || undefined;
	const last = (s: string) => s.split("/").filter(Boolean).pop() ?? "";
	const idHint = path ? last(path) : last(url.replace(/\.git$/i, ""));
	return {
		url,
		...(path && { path }),
		...(version && { version }),
		...(ref && { ref }),
		idHint,
	};
}

/** True for anything `parseGitUrlSource` accepts. */
export function isGitUrl(source: string): boolean {
	return parseGitUrlSource(source) !== null;
}

const CLONE_PROTOCOLS = new Set(["https:", "http:", "ssh:", "file:"]);

/**
 * Cache key for a clone URL: `<host>/<path>-<hash>`, e.g.
 * `git.example.com/team/skills-3fa2c1d09b7e`. Host and path keep it readable;
 * the hash of the whole URL (scheme, host, port, path; never credentials)
 * keeps two different URLs from ever sharing a mirror or a lock pin, even when
 * sanitizing makes their paths look alike. Characters Windows forbids in
 * directory names become `_`. file:// URLs keep only the repository name, so
 * an absolute local path doesn't blow past Windows path limits in the cache.
 */
export function gitRepoKey(url: string): string {
	const u = new URL(url);
	// Only real transports: `new URL` also accepts helper schemes such as
	// `ext::<command>`, which git would run (it blocks `ext` by default, but
	// capabilities files can come from elsewhere, so don't rely on that).
	if (!CLONE_PROTOCOLS.has(u.protocol)) {
		throw new Error(`Unsupported git URL scheme "${u.protocol}" in ${url}`);
	}
	u.username = "";
	u.password = "";
	const hash = createHash("sha256").update(u.href).digest("hex").slice(0, 12);
	const safe = (s: string) => s.replace(/[<>:"|?*\\]/g, "_");
	const segments = decodeURIComponent(u.pathname)
		.replace(/\.git\/?$/i, "")
		.split("/")
		.filter((s) => s && s !== "." && s !== "..")
		.map(safe);
	const name = `${segments.pop() ?? "repo"}-${hash}`;
	if (u.protocol === "file:") return `file/${name}`;
	return [safe(u.host), ...segments, name].join("/");
}
