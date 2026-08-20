import { existsSync, readFileSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import {
	isAbsolute as isWinAbsolute,
	resolve as winResolve,
} from "path/win32";
import { resolve as posixResolve } from "path/posix";
import type { OAuth2Config } from "../../types/capabilities";
import type { NormalizedPluginMCPServerDef } from "../../types/plugin";
import { asParsedMcpServerEntry, isPlainObject } from "./types-helpers";

/**
 * Pull a value from `obj` matching any of the supplied case-insensitive keys.
 * Plugin manifests authored by different ecosystems use wildly different
 * spellings for the same OAuth field (Cursor: `CLIENT_ID`, Claude: `clientId`,
 * raw OAuth2 spec: `client_id`), so we normalize them here.
 */
function pickField(
	obj: Record<string, unknown>,
	names: readonly string[],
): unknown {
	const lookup = new Map<string, unknown>();
	for (const key of Object.keys(obj)) {
		lookup.set(key.toLowerCase(), obj[key]);
	}
	for (const name of names) {
		const found = lookup.get(name.toLowerCase());
		if (found !== undefined) return found;
	}
	return undefined;
}

/** Keys that are aliases of a canonical camelCase OAuth field (stripped after map). */
const OAUTH_ALIAS_KEYS = new Set(
	[
		"client_id",
		"clientId",
		"CLIENT_ID",
		"client_secret",
		"clientSecret",
		"CLIENT_SECRET",
		"callback_port",
		"callbackPort",
		"CALLBACK_PORT",
		"authorization_endpoint",
		"authorizationEndpoint",
		"authorizationUrl",
		"authorization_url",
		"token_endpoint",
		"tokenEndpoint",
		"tokenUrl",
		"token_url",
		"resource_server",
		"resourceServer",
		"registration_endpoint",
		"registrationEndpoint",
		"redirect_uri",
		"redirectUri",
		"oauth",
		"auth",
	].map((k) => k.toLowerCase()),
);

function positivePort(value: unknown): number | undefined {
	if (typeof value === "number" && value > 0) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

/**
 * Normalize an OAuth2 config block (under any of `oauth2`/`oauth`/`auth`) to
 * the canonical capa camelCase shape. Unknown/extra non-alias fields are
 * preserved so per-server quirks can still flow through.
 */
export function normalizeOAuth2Block(
	raw: unknown,
): OAuth2Config | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!isPlainObject(raw)) return undefined;

	const nested = isPlainObject(raw.oauth)
		? raw.oauth
		: isPlainObject(raw.auth)
			? raw.auth
			: undefined;
	const flat: Record<string, unknown> = nested
		? { ...nested, ...raw }
		: { ...raw };

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (OAUTH_ALIAS_KEYS.has(key.toLowerCase())) continue;
		result[key] = value;
	}

	const clientId = pickField(flat, ["clientId", "client_id", "CLIENT_ID"]);
	if (typeof clientId === "string" && clientId.length > 0) {
		result.clientId = clientId;
	}

	const clientSecret = pickField(flat, [
		"clientSecret",
		"client_secret",
		"CLIENT_SECRET",
	]);
	if (typeof clientSecret === "string" && clientSecret.length > 0) {
		result.clientSecret = clientSecret;
	}

	const callbackPort = positivePort(
		pickField(flat, ["callbackPort", "callback_port", "CALLBACK_PORT"]),
	);
	if (callbackPort !== undefined) result.callbackPort = callbackPort;

	const authorizationEndpoint = pickField(flat, [
		"authorizationEndpoint",
		"authorization_endpoint",
		"authorizationUrl",
		"authorization_url",
	]);
	if (
		typeof authorizationEndpoint === "string" &&
		authorizationEndpoint.length > 0
	) {
		result.authorizationEndpoint = authorizationEndpoint;
	}

	const tokenEndpoint = pickField(flat, [
		"tokenEndpoint",
		"token_endpoint",
		"tokenUrl",
		"token_url",
	]);
	if (typeof tokenEndpoint === "string" && tokenEndpoint.length > 0) {
		result.tokenEndpoint = tokenEndpoint;
	}

	const resourceServer = pickField(flat, [
		"resourceServer",
		"resource_server",
	]);
	if (typeof resourceServer === "string" && resourceServer.length > 0) {
		result.resourceServer = resourceServer;
	}

	const registrationEndpoint = pickField(flat, [
		"registrationEndpoint",
		"registration_endpoint",
	]);
	if (
		typeof registrationEndpoint === "string" &&
		registrationEndpoint.length > 0
	) {
		result.registrationEndpoint = registrationEndpoint;
	}

	const redirectUri = pickField(flat, ["redirectUri", "redirect_uri"]);
	if (typeof redirectUri === "string" && redirectUri.length > 0) {
		result.redirectUri = redirectUri;
	}

	const scopes = pickField(flat, ["scopes"]);
	if (Array.isArray(scopes)) {
		result.scopes = scopes.filter((s): s is string => typeof s === "string");
	}

	const scope = pickField(flat, ["scope"]);
	if (typeof scope === "string" && scope.length > 0) {
		result.scope = scope;
	}

	const pkce = pickField(flat, ["pkce"]);
	if (typeof pkce === "boolean") result.pkce = pkce;

	return result as OAuth2Config;
}

/**
 * Normalize one MCP server entry from manifest.
 * Supports subprocess (command/cmd + args/env) and remote HTTP (url + headers/oauth).
 */
export function normalizeMcpServerEntry(
	entry: unknown,
): NormalizedPluginMCPServerDef | null {
	const parsed = asParsedMcpServerEntry(entry);
	if (!parsed) return null;

	const url = parsed.url;
	if (typeof url === "string" && url.length > 0) {
		const rawOauth = parsed.oauth2 ?? parsed.oauth ?? parsed.auth;
		return {
			url,
			headers: isPlainObject(parsed.headers)
				? (parsed.headers as Record<string, string>)
				: undefined,
			oauth2: normalizeOAuth2Block(rawOauth),
		};
	}

	const command = parsed.command ?? parsed.cmd;
	if (typeof command !== "string") return null;
	return {
		cmd: command,
		args: Array.isArray(parsed.args) ? parsed.args : undefined,
		env: isPlainObject(parsed.env)
			? (parsed.env as Record<string, string>)
			: undefined,
	};
}

/**
 * Resolve a manifest-relative path to an absolute path inside `repoRoot`.
 * Relative paths (including `../`) are resolved against `manifestDir`. The
 * resolved path is clamped to stay inside `repoRoot`; any attempt to escape
 * the repo (via too many `..`s, absolute paths, or symlink-like tricks) is
 * rejected by returning `null`.
 */
function resolveManifestPath(
	repoRoot: string,
	manifestDir: string,
	relPath: string,
): string | null {
	if (isAbsolute(relPath)) return null;
	const base = isAbsolute(manifestDir)
		? manifestDir
		: resolve(repoRoot, manifestDir);
	const candidate = resolve(base, relPath);
	const absRepo = resolve(repoRoot);
	const rel = relative(absRepo, candidate);
	if (rel.startsWith("..") || isAbsolute(rel)) return null;
	return candidate;
}

/**
 * Load one MCP config (object keyed by server id) from a manifest-relative
 * path, or return null. `manifestDir` is the directory containing the
 * referencing manifest (relative to or absolute under `repoRoot`).
 */
function loadMcpConfigFromPath(
	repoRoot: string,
	manifestDir: string,
	path: string,
): Record<string, unknown> | null {
	const fullPath = resolveManifestPath(repoRoot, manifestDir, path);
	if (!fullPath || !existsSync(fullPath)) return null;
	try {
		const content = readFileSync(fullPath, "utf-8");
		const data: unknown = JSON.parse(content);
		if (!isPlainObject(data)) return null;
		const obj = data.mcpServers ?? data;
		return isPlainObject(obj) ? obj : null;
	} catch {
		return null;
	}
}

/**
 * Merge server entries from an object into result (normalized).
 */
function mergeMcpEntries(
	result: Record<string, NormalizedPluginMCPServerDef>,
	obj: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(obj)) {
		const normalized = normalizeMcpServerEntry(value);
		if (normalized) result[key] = normalized;
	}
}

/**
 * Load MCP servers from manifest: mcpServers can be a path (string), inline object,
 * or array of paths/inline configs (Cursor format).
 *
 * `manifestDir` is the directory containing the parsed manifest (relative to
 * `repoRoot`, e.g. `.cursor-plugin`). Path-typed `mcpServers` values are
 * resolved relative to it, matching how Cursor and Claude plugins author
 * their manifests (`"mcpServers": "../.cursor-mcp.json"`).
 *
 * If no servers are found and `defaultMcpFallbackPath` is provided, that path
 * is loaded relative to `repoRoot`. As a final safety net (matching long-
 * standing capa behaviour for unconventional plugin layouts), `.mcp.json` at
 * the repo root is also tried.
 */
export function parseMcpServers(
	repoRoot: string,
	manifest: unknown,
	defaultMcpFallbackPath?: string,
	manifestDir: string = ".",
): Record<string, NormalizedPluginMCPServerDef> {
	const result: Record<string, NormalizedPluginMCPServerDef> = {};
	if (!isPlainObject(manifest)) return result;

	const raw = manifest.mcpServers ?? manifest.mcp;

	if (typeof raw === "string") {
		const obj = loadMcpConfigFromPath(repoRoot, manifestDir, raw);
		if (obj) mergeMcpEntries(result, obj);
	} else if (Array.isArray(raw)) {
		for (let i = 0; i < raw.length; i++) {
			const item = raw[i];
			if (typeof item === "string") {
				const obj = loadMcpConfigFromPath(repoRoot, manifestDir, item);
				if (obj) mergeMcpEntries(result, obj);
			} else if (isPlainObject(item)) {
				const hasCommand = "command" in item || "cmd" in item;
				if (hasCommand) {
					const normalized = normalizeMcpServerEntry(item);
					if (normalized) result[`server-${i}`] = normalized;
				} else {
					mergeMcpEntries(result, item);
				}
			}
		}
	} else if (isPlainObject(raw)) {
		mergeMcpEntries(result, raw);
	}

	if (Object.keys(result).length === 0 && defaultMcpFallbackPath) {
		const defaultObj = loadMcpConfigFromPath(
			repoRoot,
			".",
			defaultMcpFallbackPath,
		);
		if (defaultObj) mergeMcpEntries(result, defaultObj);
	}

	if (Object.keys(result).length === 0) {
		const fallback = loadMcpConfigFromPath(repoRoot, ".", ".mcp.json");
		if (fallback) mergeMcpEntries(result, fallback);
	}

	return result;
}

/**
 * Replace ${CLAUDE_PLUGIN_ROOT} and resolve explicit plugin-relative paths.
 *
 * Only strings that actually reference the plugin directory are rewritten:
 * the `${CLAUDE_PLUGIN_ROOT}` placeholder, or an explicit relative path
 * (`./x`, `../x`, `.`). Bare tokens — executable names (`uvx`, `npx`,
 * `python`), flags (`-y`), and package specs (`@scope/pkg`, `awslabs.foo`) —
 * are returned untouched so they resolve from PATH or are interpreted by the
 * launched process. Rewriting them to `<pluginRoot>/<token>` produced
 * non-existent paths and silently broke command-based MCP servers (#94).
 *
 * On Windows the expanded root uses forward slashes. Claude Code (and Cursor)
 * often run hook commands through Git Bash, which treats `\U`, `\T`, etc. as
 * escapes and strips backslashes — breaking absolute Windows paths.
 *
 * Hook commands may include args after the path (`./hooks/run-hook.cmd session-start`);
 * only the leading path token is resolved in that case.
 *
 * Pass `shellQuote: true` for hook commands run via a shell (Claude/Cursor → Git Bash).
 * Without it, MCP argv/env values keep bare paths so Node spawn does not see literal quotes.
 */
/**
 * Resolve `relPath` against a plugin root using the root's path style.
 * Windows drive roots must stay absolute even when capa runs on Unix (tests
 * and cross-platform installs), so `path.resolve` alone is not safe.
 */
function resolveUnderPluginRoot(pluginRoot: string, relPath: string): string {
	const root = pluginRoot.replace(/\\/g, "/");
	const rel = relPath.replace(/\\/g, "/");
	if (isWinAbsolute(root)) {
		return winResolve(root, rel).replace(/\\/g, "/");
	}
	return posixResolve(root, rel);
}

export function resolvePluginRootInString(
	value: string,
	pluginRoot: string,
	opts?: { shellQuote?: boolean },
): string {
	const root = pluginRoot.replace(/\\/g, "/");
	const shellQuote = opts?.shellQuote === true;

	if (value.includes("${CLAUDE_PLUGIN_ROOT}")) {
		const expanded = value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root);
		if (!shellQuote || !/\s/.test(root)) return expanded;
		// Already quoted around the expanded root (plugin authors often quote the placeholder).
		if (expanded.includes(`"${root}`)) return expanded;
		const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return expanded.replace(
			new RegExp(`${escapedRoot}[^\\s]*`, "g"),
			(path) => (/\s/.test(path) ? `"${path}"` : path),
		);
	}

	// "./path/to/cmd args..." or "../path args..." — resolve path token only.
	const relWithArgs = value.match(/^(\.[/\\][^\s]+|\.\.[/\\][^\s]+)(\s+[\s\S]*)?$/);
	if (relWithArgs) {
		const abs = resolveUnderPluginRoot(pluginRoot, relWithArgs[1]);
		const quoted = shellQuote && /\s/.test(abs) ? `"${abs}"` : abs;
		return `${quoted}${relWithArgs[2] ?? ""}`;
	}

	if (value === "." || value.startsWith("./") || value.startsWith("../")) {
		const abs = resolveUnderPluginRoot(pluginRoot, value);
		return shellQuote && /\s/.test(abs) ? `"${abs}"` : abs;
	}
	return value;
}

/**
 * Resolve plugin root in a normalized MCP server def to produce capa MCPServerDefinition.
 * For subprocess: replaces ${CLAUDE_PLUGIN_ROOT} in cmd, args, env.
 * For remote (url): returns url, headers, oauth2 as-is.
 */
export function resolvePluginServerDef(
	def: NormalizedPluginMCPServerDef,
	pluginRoot: string,
): {
	cmd?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	oauth2?: OAuth2Config;
} {
	if (def.url) {
		return {
			url: def.url,
			headers: def.headers,
			oauth2: def.oauth2,
		};
	}
	if (!def.cmd) return {};
	const cmd = resolvePluginRootInString(def.cmd, pluginRoot);
	const args = def.args?.map((a) =>
		typeof a === "string" ? resolvePluginRootInString(a, pluginRoot) : a,
	);
	let env: Record<string, string> | undefined;
	if (def.env && typeof def.env === "object") {
		env = {};
		for (const [k, v] of Object.entries(def.env)) {
			env[k] =
				typeof v === "string"
					? resolvePluginRootInString(v, pluginRoot)
					: String(v);
		}
	}
	return { cmd, args, env };
}
