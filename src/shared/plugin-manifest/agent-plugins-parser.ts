import {
	closeSync,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import type {
	NormalizedPluginMCPServerDef,
	UnifiedPluginManifest,
} from "../../types/plugin";
import { assertInsideProjectRoot } from "../install-path-guard";
import { isBlockedHostnameOrIp } from "../safe-remote-url";
import { getSkillEntriesFromPath, isPlainObject } from "./types-helpers";

/**
 * Agent Plugins v1.0.0 (https://agent-plugins.org/specification): a root
 * `plugin.json` identified by `$schema`, skills in `skills/`, MCP servers in
 * `mcp.json`. Only these two component types exist in v1; anything else in the
 * package (including reverse-domain extension dirs) is ignored.
 *
 * Validation is lenient: manifest and mcp.json problems become warnings, and
 * an invalid mcp.json or server entry never blocks the plugin's skills.
 */
export const AGENT_PLUGINS_MANIFEST_SCHEMA =
	"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const AGENT_PLUGINS_MCP_SCHEMA =
	"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const MANIFEST_FIELDS = new Set([
	"$schema",
	"name",
	"version",
	"description",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"extensions",
]);
const STRING_FIELDS = [
	"version",
	"description",
	"homepage",
	"repository",
	"license",
];
const NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const STDIO_FIELDS = new Set(["type", "command", "args", "env", "cwd"]);
const REMOTE_FIELDS = new Set(["type", "url", "headers"]);
const CWD_PATTERN =
	/^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/;
// Downstream resolvers fill any other `${NAME}` from the user's variables or
// environment, which would hand the plugin the user's secrets.
const NON_SPEC_PLACEHOLDER = /\$\{(?!PLUGIN_ROOT\}|PLUGIN_DATA\})/;
// On Windows `:` makes a drive-relative path (`D:tool.exe`).
const BARE_COMMAND = /^[A-Za-z0-9._+-]+$/;

/**
 * Plugin-supplied text made safe to print: C0/C1 control characters (ESC,
 * BEL, CR, ...) are removed so a plugin can't emit terminal escape sequences.
 * Newlines and tabs are kept for capa's own multi-line messages.
 */
export function stripControlChars(s: string): string {
	return s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

/** Quote one plugin-supplied value for a warning (single line, no controls). */
const q = (s: string): string => JSON.stringify(stripControlChars(s));

export function isAgentPluginsManifest(data: unknown): boolean {
	return isPlainObject(data) && data.$schema === AGENT_PLUGINS_MANIFEST_SCHEMA;
}

/**
 * Real path of `p`, resolving symlinks/junctions in its longest existing
 * ancestor and appending the missing components. Throws on a dangling link.
 */
function realpathOfExisting(p: string): string {
	let cur = resolve(p);
	const rest: string[] = [];
	while (!lstatSync(cur, { throwIfNoEntry: false })) {
		const parent = dirname(cur);
		if (parent === cur) break;
		rest.unshift(basename(cur));
		cur = parent;
	}
	return join(realpathSync(cur), ...rest);
}

/**
 * True when `target` is `root` or inside it, both lexically and after
 * resolving symlinks/junctions in the existing part of each path.
 */
function isContained(root: string, target: string): boolean {
	const within = (r: string, t: string): boolean => {
		if (relative(resolve(r), resolve(t)) === "") return true;
		try {
			assertInsideProjectRoot(r, t);
			return true;
		} catch {
			return false;
		}
	};
	if (!within(root, target)) return false;
	try {
		return within(realpathOfExisting(root), realpathOfExisting(target));
	} catch {
		return false;
	}
}

function manifestWarnings(m: Record<string, unknown>): string[] {
	const w: string[] = [];
	for (const key of Object.keys(m)) {
		if (!MANIFEST_FIELDS.has(key)) {
			w.push(`plugin.json: unknown field ${q(key)} ignored`);
		}
	}
	if (
		typeof m.name !== "string" ||
		m.name.length > 64 ||
		!NAME_PATTERN.test(m.name)
	) {
		w.push(
			'plugin.json: "name" must be 1-64 lowercase letters, digits, "-" or "." (alphanumeric at both ends, no "--" or "..")',
		);
	}
	for (const key of STRING_FIELDS) {
		if (key in m && typeof m[key] !== "string") {
			w.push(`plugin.json: "${key}" must be a string`);
		}
	}
	if (
		"keywords" in m &&
		!(
			Array.isArray(m.keywords) &&
			m.keywords.every((k) => typeof k === "string")
		)
	) {
		w.push('plugin.json: "keywords" must be an array of strings');
	}
	if (
		"author" in m &&
		!(
			isPlainObject(m.author) &&
			Object.entries(m.author).every(
				([k, v]) =>
					(k === "name" || k === "email" || k === "url") &&
					typeof v === "string",
			)
		)
	) {
		w.push(
			'plugin.json: "author" may only contain string "name", "email" and "url"',
		);
	}
	if (
		"extensions" in m &&
		!(
			isPlainObject(m.extensions) &&
			Object.values(m.extensions).every(isPlainObject)
		)
	) {
		w.push('plugin.json: "extensions" must be an object of objects; ignored');
	}
	return w;
}

function stringMap(value: unknown): Record<string, string> | null {
	if (!isPlainObject(value)) return null;
	for (const v of Object.values(value)) if (typeof v !== "string") return null;
	return value as Record<string, string>;
}

function isLoopbackHost(host: string): boolean {
	const h = host.replace(/^\[|\]$/g, "").toLowerCase();
	return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Validate one `mcp.json` server entry. Returns the normalized def, or a
 * reason string when the entry must be skipped.
 */
function parseServerEntry(
	pluginRoot: string,
	entry: unknown,
): NormalizedPluginMCPServerDef | string {
	if (!isPlainObject(entry)) return "entry must be an object";
	const type = entry.type;

	if (type === "stdio") {
		const extra = Object.keys(entry).filter((k) => !STDIO_FIELDS.has(k));
		if (extra.length) return `unknown field(s): ${extra.map(q).join(", ")}`;
		const command = entry.command;
		if (typeof command !== "string" || !command) {
			return '"command" must be a non-empty string';
		}
		if (command.startsWith("./")) {
			if (!isContained(pluginRoot, join(pluginRoot, command))) {
				return '"command" resolves outside the plugin root';
			}
		} else if (!BARE_COMMAND.test(command)) {
			return '"command" must be one bare executable name (letters, digits, ".", "_", "+", "-") or a "./" plugin-relative path';
		}
		if (
			entry.args !== undefined &&
			!(
				Array.isArray(entry.args) &&
				entry.args.every((a) => typeof a === "string")
			)
		) {
			return '"args" must be an array of strings';
		}
		let env: Record<string, string> | undefined;
		if (entry.env !== undefined) {
			const parsed = stringMap(entry.env);
			if (!parsed) return '"env" must be an object of strings';
			if ("PLUGIN_ROOT" in parsed || "PLUGIN_DATA" in parsed) {
				return '"env" must not set PLUGIN_ROOT or PLUGIN_DATA';
			}
			env = parsed;
		}
		const cwd = entry.cwd;
		if (cwd !== undefined) {
			if (typeof cwd !== "string" || !CWD_PATTERN.test(cwd)) {
				return '"cwd" must start with "./", "${PLUGIN_ROOT}" or "${PLUGIN_DATA}"';
			}
			// PLUGIN_DATA containment is checked when the data dir is known.
			if (!cwd.startsWith("${PLUGIN_DATA}")) {
				const abs = resolve(pluginRoot, cwd.replace("${PLUGIN_ROOT}", "."));
				if (!isContained(pluginRoot, abs)) {
					return '"cwd" resolves outside the plugin root';
				}
			}
		}
		const values = [
			command,
			...((entry.args as string[] | undefined) ?? []),
			...Object.values(env ?? {}),
			...(cwd === undefined ? [] : [cwd]),
		];
		if (values.some((v) => NON_SPEC_PLACEHOLDER.test(v))) {
			return 'only "${PLUGIN_ROOT}" and "${PLUGIN_DATA}" may appear as "${...}" in command, args, env and cwd';
		}
		return {
			cmd: command,
			args: entry.args as string[] | undefined,
			env,
			cwd,
		};
	}

	if (type === "streamable-http" || type === "sse") {
		const extra = Object.keys(entry).filter((k) => !REMOTE_FIELDS.has(k));
		if (extra.length) return `unknown field(s): ${extra.map(q).join(", ")}`;
		if (typeof entry.url !== "string") return '"url" must be a string';
		if (entry.url.includes("${")) return '"url" must not contain "${...}"';
		let url: URL;
		try {
			url = new URL(entry.url);
		} catch {
			return '"url" must be an absolute URL';
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return '"url" must use http or https';
		}
		const loopback = isLoopbackHost(url.hostname);
		if (url.protocol === "http:" && !loopback) {
			return '"url" must use https for non-loopback hosts';
		}
		// Loopback stays allowed for local dev servers; private, link-local and
		// cloud metadata hosts follow capa's SSRF policy for remote fetches.
		if (!loopback && isBlockedHostnameOrIp(url.hostname)) {
			return '"url" must not target a private, link-local or metadata host';
		}
		if (url.username || url.password || entry.url.includes("#")) {
			return '"url" must not contain credentials or a fragment';
		}
		let headers: Record<string, string> | undefined;
		if (entry.headers !== undefined) {
			const parsed = stringMap(entry.headers);
			if (!parsed) return '"headers" must be an object of strings';
			const names = Object.keys(parsed).map((k) => k.toLowerCase());
			if (new Set(names).size !== names.length) {
				return '"headers" repeats a header name with different casing';
			}
			if (Object.values(parsed).some((v) => v.includes("${"))) {
				return '"headers" values must not contain "${...}"';
			}
			headers = parsed;
		}
		// capa's HTTP transport speaks Streamable HTTP only.
		if (type === "sse") {
			return 'transport "sse" (legacy HTTP+SSE) is not supported by capa';
		}
		return { url: entry.url, headers };
	}

	return `unsupported "type" ${JSON.stringify(type)} (expected stdio, streamable-http or sse)`;
}

function parseMcpJson(pluginRoot: string): {
	servers: Record<string, NormalizedPluginMCPServerDef>;
	warnings: string[];
} {
	const servers: Record<string, NormalizedPluginMCPServerDef> = {};
	const path = join(pluginRoot, "mcp.json");

	const disabled = (why: string) => ({
		servers,
		warnings: [`mcp.json ${why}; MCP servers disabled for this plugin`],
	});
	const notRegular = "is not a regular file inside the plugin root";
	if (!isContained(pluginRoot, path)) return disabled(notRegular);
	// Open once and read through the descriptor. `openSync` follows links, so
	// after opening, re-check containment and that the path still names the
	// opened file: a swap to a link between the check and the open is rejected.
	let data: unknown;
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const opened = fstatSync(fd, { bigint: true });
		if (!opened.isFile() || !isContained(pluginRoot, path)) {
			return disabled(notRegular);
		}
		const now = statSync(path, { bigint: true });
		if (now.dev !== opened.dev || now.ino !== opened.ino) {
			return disabled(notRegular);
		}
		data = JSON.parse(readFileSync(fd, "utf-8"));
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { servers, warnings: [] };
		return disabled(code === "EISDIR" ? notRegular : "is not valid JSON");
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	if (!isPlainObject(data) || data.$schema !== AGENT_PLUGINS_MCP_SCHEMA) {
		return disabled(`must declare "$schema": "${AGENT_PLUGINS_MCP_SCHEMA}"`);
	}
	if (!isPlainObject(data.mcpServers)) {
		return disabled('must contain an "mcpServers" object');
	}
	const extra = Object.keys(data).filter(
		(k) => k !== "$schema" && k !== "mcpServers",
	);
	if (extra.length) {
		return disabled(`has unknown top-level field(s): ${extra.map(q).join(", ")}`);
	}

	const warnings: string[] = [];
	for (const [key, entry] of Object.entries(data.mcpServers)) {
		if (key === "__proto__") {
			warnings.push('mcp.json: server "__proto__" skipped: reserved name');
			continue;
		}
		const parsed = parseServerEntry(pluginRoot, entry);
		if (typeof parsed === "string") {
			warnings.push(`mcp.json: server ${q(key)} skipped: ${parsed}`);
		} else {
			servers[key] = parsed;
		}
	}
	return { servers, warnings };
}

/**
 * Parse an Agent Plugins root `plugin.json`. Returns null when `data` does
 * not declare the v1.0.0 manifest `$schema`, so detection falls through.
 */
export function parseAgentPluginsManifest(
	pluginRoot: string,
	data: unknown,
): UnifiedPluginManifest | null {
	if (!isAgentPluginsManifest(data)) return null;
	const m = data as Record<string, unknown>;
	const mcp = parseMcpJson(pluginRoot);
	const warnings = [...manifestWarnings(m), ...mcp.warnings];
	return {
		name: typeof m.name === "string" && m.name ? m.name : "unknown",
		version: typeof m.version === "string" ? m.version : undefined,
		description: typeof m.description === "string" ? m.description : undefined,
		provider: "agent-plugins",
		skillEntries: getSkillEntriesFromPath(pluginRoot, "skills"),
		mcpServers: mcp.servers,
		...(warnings.length ? { warnings } : {}),
	};
}

/**
 * Turn a parsed Agent Plugins stdio/remote server into a capa server def.
 * `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` are expanded once, non-recursively, only
 * in `args`, `env` values and `cwd`. `cwd` defaults to the plugin root, and
 * both variables are set in the subprocess env. Throws when `cwd` escapes its
 * root after expansion.
 */
export function resolveAgentPluginsServerDef(
	def: NormalizedPluginMCPServerDef,
	pluginRoot: string,
	dataDir: string,
): {
	cmd?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
} {
	if (def.url) return { url: def.url, headers: def.headers };
	if (!def.cmd) return {};
	const expand = (s: string): string =>
		s.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g, (_, name: string) =>
			name === "PLUGIN_ROOT" ? pluginRoot : dataDir,
		);

	const cwdBase = def.cwd?.startsWith("${PLUGIN_DATA}") ? dataDir : pluginRoot;
	const cwd = def.cwd ? resolve(pluginRoot, expand(def.cwd)) : pluginRoot;
	if (!isContained(cwdBase, cwd)) {
		throw new Error(`"cwd" resolves outside ${cwdBase}`);
	}
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(def.env ?? {})) env[k] = expand(v);
	env.PLUGIN_ROOT = pluginRoot;
	env.PLUGIN_DATA = dataDir;

	return {
		cmd: def.cmd.startsWith("./") ? join(pluginRoot, def.cmd) : def.cmd,
		args: def.args?.map(expand),
		env,
		cwd,
	};
}
