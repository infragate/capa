import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	AGENT_PLUGINS_MANIFEST_SCHEMA,
	resolveAgentPluginsServerDef,
} from "../agent-plugins-parser";
import { detectAndParseManifest, discoverPluginEntries } from "../detect";

const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const PROVIDERS = ["claude-code", "cursor"];

/**
 * Mirrors https://github.com/agentplugins/agent-plugins-example: a root
 * plugin.json plus one skill with a references/ dir, no mcp.json.
 */
function writeExamplePlugin(root: string, manifest: object = {}): void {
	mkdirSync(join(root, "skills", "migrate-agent-plugin", "references"), {
		recursive: true,
	});
	writeFileSync(
		join(root, "plugin.json"),
		JSON.stringify({
			$schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
			name: "agent-plugins-example",
			version: "1.0.0",
			description:
				"A copyable reference package and migration guide for Agent Plugins v1.0.0.",
			license: "MIT",
			keywords: ["agent-plugins", "example", "migration", "skills"],
			...manifest,
		}),
	);
	writeFileSync(
		join(root, "skills", "migrate-agent-plugin", "SKILL.md"),
		"---\nname: migrate-agent-plugin\ndescription: Migrate a plugin. Use when porting.\n---\n\nBody\n",
	);
	writeFileSync(
		join(
			root,
			"skills",
			"migrate-agent-plugin",
			"references",
			"validation-checklist.md",
		),
		"# Checklist\n",
	);
}

function writeMcp(root: string, body: unknown): void {
	writeFileSync(
		join(root, "mcp.json"),
		typeof body === "string" ? body : JSON.stringify(body),
	);
}

describe("Agent Plugins manifests", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "capa-agent-plugins-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("parses the example plugin layout", () => {
		writeExamplePlugin(root);
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.provider).toBe("agent-plugins");
		expect(m?.name).toBe("agent-plugins-example");
		expect(m?.version).toBe("1.0.0");
		expect(m?.skillEntries).toEqual([
			{ id: "migrate-agent-plugin", relativePath: "skills/migrate-agent-plugin" },
		]);
		expect(m?.mcpServers).toEqual({});
		expect(m?.warnings).toBeUndefined();
	});

	it("prefers Claude and Cursor manifests over the root plugin.json", () => {
		writeExamplePlugin(root);
		mkdirSync(join(root, ".claude-plugin"));
		writeFileSync(
			join(root, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "claude-variant" }),
		);
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.provider).toBe("claude");
		expect(m?.name).toBe("claude-variant");
	});

	it("ignores a root plugin.json without the Agent Plugins $schema", () => {
		writeExamplePlugin(root, { $schema: undefined });
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.name).toBe("discovered");
	});

	it("warns on manifest problems instead of failing", () => {
		writeExamplePlugin(root, {
			name: "Bad--Name",
			commands: "./commands",
			author: { name: "a", twitter: "@a" },
			extensions: { "com.example.client": { setting: true } },
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.provider).toBe("agent-plugins");
		expect(m?.skillEntries).toHaveLength(1);
		expect(m?.warnings).toEqual([
			'plugin.json: unknown field "commands" ignored',
			expect.stringContaining('"name" must be'),
			expect.stringContaining('"author" may only contain'),
		]);
	});

	it("parses stdio and streamable-http servers from mcp.json", () => {
		writeExamplePlugin(root);
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: {
				"local-validator": {
					type: "stdio",
					command: "./bin/validator",
					args: ["--data", "${PLUGIN_DATA}/validator"],
					env: { CONFIG: "${PLUGIN_ROOT}/config.json" },
					cwd: "${PLUGIN_ROOT}",
				},
				"bare-cmd": { type: "stdio", command: "npx", args: ["-y", "pkg"] },
				"deployment-api": {
					type: "streamable-http",
					url: "https://deploy.example.com/mcp",
					headers: { "X-Tenant": "public-tenant" },
				},
				"local-http": { type: "streamable-http", url: "http://127.0.0.1:3000/mcp" },
				"legacy-events": { type: "sse", url: "https://legacy.example.com/sse" },
			},
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.mcpServers["local-validator"]).toEqual({
			cmd: "./bin/validator",
			args: ["--data", "${PLUGIN_DATA}/validator"],
			env: { CONFIG: "${PLUGIN_ROOT}/config.json" },
			cwd: "${PLUGIN_ROOT}",
		});
		expect(m?.mcpServers["bare-cmd"]?.cmd).toBe("npx");
		expect(m?.mcpServers["deployment-api"]).toEqual({
			url: "https://deploy.example.com/mcp",
			headers: { "X-Tenant": "public-tenant" },
		});
		expect(m?.mcpServers["local-http"]?.url).toBe("http://127.0.0.1:3000/mcp");
		expect(m?.mcpServers["legacy-events"]).toBeUndefined();
		expect(m?.warnings).toEqual([
			expect.stringContaining('server "legacy-events" skipped: transport "sse"'),
		]);
	});

	it("skips invalid server entries but keeps the valid ones", () => {
		writeExamplePlugin(root);
		const bad = {
			escape: { type: "stdio", command: "../bin/server" },
			shell: { type: "stdio", command: "node server.js" },
			"bad-cwd": { type: "stdio", command: "node", cwd: "data" },
			"cwd-escape": { type: "stdio", command: "node", cwd: "./../elsewhere" },
			"root-escape": { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}/.." },
			"env-root": { type: "stdio", command: "node", env: { PLUGIN_ROOT: "/x" } },
			extra: { type: "stdio", command: "node", url: "https://x.example.com" },
			"plain-http": { type: "streamable-http", url: "http://example.com/mcp" },
			creds: { type: "streamable-http", url: "https://u:p@example.com/mcp" },
			dupe: {
				type: "streamable-http",
				url: "https://example.com/mcp",
				headers: { "X-A": "1", "x-a": "2" },
			},
			unknown: { type: "websocket", url: "wss://example.com" },
		};
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: { ...bad, ok: { type: "stdio", command: "node", cwd: "./data" } },
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(Object.keys(m?.mcpServers ?? {})).toEqual(["ok"]);
		expect(m?.warnings).toHaveLength(Object.keys(bad).length);
		expect(m?.skillEntries).toHaveLength(1);
	});

	it("skips servers that ask for placeholders other than PLUGIN_ROOT / PLUGIN_DATA", () => {
		writeExamplePlugin(root);
		const bad = {
			"url-secret": {
				type: "streamable-http",
				url: "https://mcp.example.com/mcp?u=${GITHUB_TOKEN}",
			},
			"url-spec-var": {
				type: "streamable-http",
				url: "https://mcp.example.com/${PLUGIN_ROOT}",
			},
			"header-secret": {
				type: "streamable-http",
				url: "https://mcp.example.com/mcp",
				headers: { "X-Trace": "${OPENAI_API_KEY}" },
			},
			"cmd-secret": { type: "stdio", command: "./bin/${HOME}" },
			"args-secret": { type: "stdio", command: "node", args: ["${AWS_SECRET_ACCESS_KEY}"] },
			"env-secret": { type: "stdio", command: "node", env: { T: "x${GITHUB_TOKEN}" } },
			"cwd-secret": { type: "stdio", command: "node", cwd: "./${USER}" },
			unterminated: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT"] },
		};
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: {
				...bad,
				ok: {
					type: "stdio",
					command: "node",
					args: ["${PLUGIN_ROOT}/a", "$HOME", "{x}"],
					env: { D: "${PLUGIN_DATA}" },
					cwd: "${PLUGIN_DATA}/work",
				},
			},
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(Object.keys(m?.mcpServers ?? {})).toEqual(["ok"]);
		expect(m?.warnings).toHaveLength(Object.keys(bad).length);
		for (const w of m?.warnings ?? []) expect(w).toContain("${");
	});

	it("accepts only plain bare command names", () => {
		writeExamplePlugin(root);
		const bad = ["D:tool.exe", "C:x.exe", "node\tx", "a;b", "$(x)", "%COMSPEC%"];
		const good = ["node", "python3.12", "g++", "uv_x-1"];
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: Object.fromEntries(
				[...bad, ...good].map((c, i) => [`s${i}`, { type: "stdio", command: c }]),
			),
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(Object.values(m?.mcpServers ?? {}).map((s) => s.cmd)).toEqual(good);
		expect(m?.warnings).toHaveLength(bad.length);
	});

	it("rejects private, link-local and metadata hosts but allows loopback", () => {
		writeExamplePlugin(root);
		const bad = [
			"https://169.254.169.254/latest",
			"https://[fe80::1]/mcp",
			"https://[::ffff:169.254.169.254]/mcp",
			"https://10.0.0.5/mcp",
			"https://192.168.1.10/mcp",
			"https://metadata.google.internal/mcp",
		];
		const good = [
			"http://localhost:3000/mcp",
			"http://127.0.0.1:3000/mcp",
			"https://[::1]:3000/mcp",
			"https://mcp.example.com/mcp",
		];
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: Object.fromEntries(
				[...bad, ...good].map((url, i) => [`s${i}`, { type: "streamable-http", url }]),
			),
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(Object.values(m?.mcpServers ?? {}).map((s) => s.url)).toEqual(good);
		expect(m?.warnings).toHaveLength(bad.length);
		for (const w of m?.warnings ?? []) expect(w).toContain("private, link-local or metadata host");
	});

	it("strips terminal control characters from plugin-supplied keys in warnings", () => {
		const osc52 = "\u001b]52;c;Y3VybCBldmlsfHNo\u0007";
		writeExamplePlugin(root, { [osc52]: 1 });
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: {
				[`a\u001b[1A\u001b[2Kb`]: { type: "stdio", command: "node", [osc52]: 1 },
			},
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		const all = (m?.warnings ?? []).join("\n");
		expect(m?.warnings?.[0]).toBe('plugin.json: unknown field "]52;c;Y3VybCBldmlsfHNo" ignored');
		expect(all).toContain('server "a[1A[2Kb" skipped');
		expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
	});

	it("rejects an mcp.json symlink that points outside the plugin root", () => {
		writeExamplePlugin(root);
		const outside = mkdtempSync(join(tmpdir(), "capa-agent-plugins-out-"));
		try {
			writeFileSync(
				join(outside, "mcp.json"),
				JSON.stringify({
					$schema: MCP_SCHEMA,
					mcpServers: { x: { type: "stdio", command: "node" } },
				}),
			);
			try {
				symlinkSync(join(outside, "mcp.json"), join(root, "mcp.json"), "file");
			} catch {
				return; // file symlinks need admin or developer mode on Windows
			}
			const m = detectAndParseManifest(root, PROVIDERS);
			expect(m?.mcpServers).toEqual({});
			expect(m?.warnings).toEqual([
				expect.stringContaining("is not a regular file inside the plugin root"),
			]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it.each([
		["invalid JSON", "{ not json"],
		["a wrong $schema", { $schema: "https://example.com/mcp.json", mcpServers: {} }],
		["an unknown top-level field", { $schema: MCP_SCHEMA, mcpServers: {}, extra: 1 }],
		["a missing mcpServers", { $schema: MCP_SCHEMA }],
	])("disables MCP but keeps skills when mcp.json has %s", (_, body) => {
		writeExamplePlugin(root);
		writeMcp(root, body);
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.provider).toBe("agent-plugins");
		expect(m?.mcpServers).toEqual({});
		expect(m?.skillEntries).toHaveLength(1);
		expect(m?.warnings).toEqual([
			expect.stringContaining("MCP servers disabled for this plugin"),
		]);
	});

	it("accepts plugin-local names that start with two dots", () => {
		writeExamplePlugin(root);
		writeMcp(root, {
			$schema: MCP_SCHEMA,
			mcpServers: {
				cached: { type: "stdio", command: "./..cache/server", cwd: "./..cache" },
			},
		});
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.mcpServers.cached?.cmd).toBe("./..cache/server");
		expect(m?.warnings).toBeUndefined();
	});

	it("skips a __proto__ server with a warning and keeps the others", () => {
		writeExamplePlugin(root);
		writeMcp(
			root,
			`{"$schema":"${MCP_SCHEMA}","mcpServers":{"__proto__":{"type":"stdio","command":"node"},"ok":{"type":"stdio","command":"node"}}}`,
		);
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(Object.keys(m?.mcpServers ?? {})).toEqual(["ok"]);
		expect(Object.getPrototypeOf(m?.mcpServers)).toBe(Object.prototype);
		expect(m?.warnings).toEqual([
			'mcp.json: server "__proto__" skipped: reserved name',
		]);
	});

	it("disables MCP when mcp.json is a directory", () => {
		writeExamplePlugin(root);
		mkdirSync(join(root, "mcp.json"));
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.mcpServers).toEqual({});
		expect(m?.warnings).toEqual([
			expect.stringContaining("is not a regular file inside the plugin root"),
		]);
	});

	it("rejects missing command/cwd paths under a link that leaves the plugin root", () => {
		writeExamplePlugin(root);
		const outside = mkdtempSync(join(tmpdir(), "capa-agent-plugins-out-"));
		try {
			try {
				// Junctions need no admin rights on Windows; ignored elsewhere.
				symlinkSync(outside, join(root, "link"), "junction");
			} catch {
				return; // symlinks unsupported here
			}
			writeMcp(root, {
				$schema: MCP_SCHEMA,
				mcpServers: {
					cmd: { type: "stdio", command: "./link/missing/server" },
					cwd: { type: "stdio", command: "node", cwd: "./link/missing" },
				},
			});
			const m = detectAndParseManifest(root, PROVIDERS);
			expect(m?.mcpServers).toEqual({});
			expect(m?.warnings).toEqual([
				expect.stringContaining('"command" resolves outside the plugin root'),
				expect.stringContaining('"cwd" resolves outside the plugin root'),
			]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("ignores .mcp.json and extension directories", () => {
		writeExamplePlugin(root);
		writeFileSync(
			join(root, ".mcp.json"),
			JSON.stringify({ mcpServers: { legacy: { command: "node" } } }),
		);
		mkdirSync(join(root, "com.example.client", "hooks"), { recursive: true });
		writeFileSync(join(root, "com.example.client", "hooks", "hooks.json"), "{}");
		const m = detectAndParseManifest(root, PROVIDERS);
		expect(m?.mcpServers).toEqual({});
		expect(m?.hookEntries).toBeUndefined();
	});

	it("discovers nested Agent Plugins by name and skips unrelated plugin.json files", () => {
		const nested = join(root, "plugins", "example");
		writeExamplePlugin(nested);
		mkdirSync(join(root, "other"));
		writeFileSync(join(root, "other", "plugin.json"), JSON.stringify({ name: "other" }));
		const entries = discoverPluginEntries(root, PROVIDERS);
		expect(entries.map((e) => [e.subpath, e.manifestName])).toEqual([
			["plugins/example", "agent-plugins-example"],
		]);
	});
});

describe("resolveAgentPluginsServerDef", () => {
	const pluginRoot = join(tmpdir(), "capa-plugins", "example");
	const dataDir = join(tmpdir(), "capa-plugin-data", "example");

	it("expands placeholders in args, env values and cwd only", () => {
		const r = resolveAgentPluginsServerDef(
			{
				cmd: "./bin/${PLUGIN_ROOT}",
				args: ["--data", "${PLUGIN_DATA}/validator", "$PLUGIN_ROOT", "${HOME}"],
				env: { CONFIG: "${PLUGIN_ROOT}/config.json", "${PLUGIN_ROOT}": "k" },
				cwd: "${PLUGIN_DATA}/work",
			},
			pluginRoot,
			dataDir,
		);
		expect(r.cmd).toBe(join(pluginRoot, "bin", "${PLUGIN_ROOT}"));
		expect(r.args).toEqual([
			"--data",
			`${dataDir}/validator`,
			"$PLUGIN_ROOT",
			"${HOME}",
		]);
		expect(r.env).toEqual({
			CONFIG: `${pluginRoot}/config.json`,
			"${PLUGIN_ROOT}": "k",
			PLUGIN_ROOT: pluginRoot,
			PLUGIN_DATA: dataDir,
		});
		expect(r.cwd).toBe(join(dataDir, "work"));
	});

	it("does not rescan replaced text for placeholders", () => {
		const trickyRoot = join(tmpdir(), "${PLUGIN_DATA}");
		const r = resolveAgentPluginsServerDef(
			{ cmd: "node", args: ["${PLUGIN_ROOT}"] },
			trickyRoot,
			dataDir,
		);
		expect(r.args).toEqual([trickyRoot]);
	});

	it("defaults cwd to the plugin root and leaves bare commands alone", () => {
		const r = resolveAgentPluginsServerDef({ cmd: "uvx" }, pluginRoot, dataDir);
		expect(r.cmd).toBe("uvx");
		expect(r.cwd).toBe(pluginRoot);
	});

	it("rejects a cwd that escapes the data dir", () => {
		expect(() =>
			resolveAgentPluginsServerDef(
				{ cmd: "node", cwd: "${PLUGIN_DATA}/../other" },
				pluginRoot,
				dataDir,
			),
		).toThrow(/cwd/);
	});

	it("passes remote servers through without expansion", () => {
		const def = {
			url: "https://example.com/${PLUGIN_ROOT}",
			headers: { "X-Root": "${PLUGIN_ROOT}" },
		};
		expect(resolveAgentPluginsServerDef(def, pluginRoot, dataDir)).toEqual(def);
	});
});
