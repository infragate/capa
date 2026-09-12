import { describe, expect, it } from "bun:test";
import type { Capabilities, MCPServer } from "../../types/capabilities";
import {
	expandServerExposedTools,
	exposedToolNamesForServer,
	selectExposedToolNames,
} from "../server-tool-exposure";

function server(expose?: MCPServer["expose"], tools?: string[]): MCPServer {
	return {
		id: "github",
		type: "mcp",
		def: { url: "https://example.test/mcp" },
		...(expose ? { expose } : {}),
		...(tools ? { tools } : {}),
	};
}

function caps(partial: Partial<Capabilities> = {}): Capabilities {
	return {
		providers: ["claude-code"],
		options: {},
		skills: [],
		servers: [],
		tools: [],
		...partial,
	} as Capabilities;
}

const REMOTE = ["search", "create_issue", "delete_repo"];

describe("selectExposedToolNames", () => {
	it("exposes nothing when no policy is set", () => {
		expect(selectExposedToolNames(server(), REMOTE).exposed).toEqual([]);
	});

	it("all exposes every advertised tool", () => {
		expect(selectExposedToolNames(server("all"), REMOTE).exposed).toEqual(REMOTE);
	});

	it("except removes the denylisted names", () => {
		expect(
			selectExposedToolNames(server("except", ["delete_repo"]), REMOTE).exposed,
		).toEqual(["search", "create_issue"]);
	});

	it("exactly keeps only the allowlisted names", () => {
		expect(
			selectExposedToolNames(server("exactly", ["search"]), REMOTE).exposed,
		).toEqual(["search"]);
	});

	it("reports names the server does not advertise", () => {
		const { exposed, unknown } = selectExposedToolNames(
			server("exactly", ["search", "typo_tool"]),
			REMOTE,
		);
		expect(exposed).toEqual(["search"]);
		expect(unknown).toEqual(["typo_tool"]);
	});
});

describe("expandServerExposedTools", () => {
	const list = async () => REMOTE.map((name) => ({ name, description: `d:${name}` }));

	it("leaves capabilities untouched when no server sets a policy", async () => {
		const input = caps({ servers: [server()] });
		const result = await expandServerExposedTools(input, list);
		expect(result.capabilities).toBe(input);
		expect(result.warnings).toEqual([]);
	});

	it("synthesizes one tool per exposed remote tool", async () => {
		const result = await expandServerExposedTools(
			caps({ servers: [server("all")] }),
			list,
		);
		expect(result.capabilities.tools.map((t) => t.id)).toEqual(REMOTE);
		expect(result.capabilities.tools.every((t) => t.fromServerExpose)).toBe(true);
		expect(result.capabilities.tools[0].description).toBe("d:search");
	});

	it("keeps an explicit entry as the overlay for that remote tool", async () => {
		const explicit = {
			id: "gh_search",
			type: "mcp" as const,
			def: {
				server: "@github",
				tool: "search",
				defaults: { count: 5 },
			},
		};
		const result = await expandServerExposedTools(
			caps({ servers: [server("all")], tools: [explicit] }),
			list,
		);

		const forSearch = result.capabilities.tools.filter(
			(t) => t.type === "mcp" && t.def.tool === "search",
		);
		expect(forSearch).toHaveLength(1);
		expect(forSearch[0]).toBe(explicit);
		expect(result.capabilities.tools.map((t) => t.id)).toEqual([
			"gh_search",
			"create_issue",
			"delete_repo",
		]);
	});

	it("warns instead of throwing when a server cannot be listed", async () => {
		const result = await expandServerExposedTools(
			caps({ servers: [server("all")] }),
			async () => {
				throw new Error("HTTP 401");
			},
		);
		expect(result.capabilities.tools).toEqual([]);
		expect(result.warnings[0]).toMatch(/github.*HTTP 401/);
	});

	it("warns when except/exactly names a tool the server does not have", async () => {
		const result = await expandServerExposedTools(
			caps({ servers: [server("exactly", ["search", "nope"])] }),
			list,
		);
		expect(result.capabilities.tools.map((t) => t.id)).toEqual(["search"]);
		expect(result.warnings[0]).toMatch(/does not advertise: nope/);
	});

	it("reports the synthesized tools separately from the merged list", async () => {
		const result = await expandServerExposedTools(
			caps({ servers: [server("exactly", ["search"])] }),
			list,
		);
		expect(result.added.map((t) => t.id)).toEqual(["search"]);
		expect(result.added.every((t) => t.fromServerExpose)).toBe(true);
	});

	it("lists a server's exposed tools by qualified name", async () => {
		const result = await expandServerExposedTools(
			caps({ servers: [server("except", ["delete_repo"])] }),
			list,
		);
		expect(exposedToolNamesForServer(result.capabilities, "github")).toEqual([
			"github.search",
			"github.create_issue",
		]);
	});
});
