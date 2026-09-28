/**
 * Generic git sources: any repository reachable by a clone URL, not only
 * github.com or gitlab.com. `capa add` recognizes them by the `.git` suffix.
 *
 *   https://git.example.com/team/skills.git
 *   https://git.example.com/team/skills.git::path/to/skill   exact subpath
 *   https://git.example.com/team/skills.git:v1.2.0           tag or branch
 *   https://git.example.com/team/skills.git#<sha>            commit
 */

import { createHash } from "crypto";

const GIT_URL_RE =
	/^((?:https?|file):\/\/.+?\.git)\/?(?:::([^:#]+))?(?::([\w.+/-]+))?(?:#([a-f0-9]{7,40}))?$/i;

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

/**
 * Cache key for a clone URL: `<host>/<path>` without the `.git` suffix, e.g.
 * `git.example.com/team/skills`. Characters Windows forbids in directory names
 * (a port's `:`) become `_`. file:// URLs become `file/<name>-<hash>`, so an
 * absolute local path doesn't blow past Windows path limits in the cache.
 */
export function gitRepoKey(url: string): string {
	const u = new URL(url);
	const path = decodeURIComponent(u.pathname).replace(/\.git\/?$/i, "");
	if (u.protocol === "file:") {
		const name = path.split("/").filter(Boolean).pop() ?? "repo";
		const hash = createHash("sha256").update(u.href).digest("hex").slice(0, 12);
		return `file/${name.replace(/[<>:"|?*\\]/g, "_")}-${hash}`;
	}
	return [u.host, ...path.split("/")]
		.filter((s) => s && s !== "." && s !== "..")
		.map((s) => s.replace(/[<>:"|?*\\]/g, "_"))
		.join("/");
}
