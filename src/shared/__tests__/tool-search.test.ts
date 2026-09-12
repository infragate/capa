import { describe, expect, it } from "bun:test";
import type { Capabilities } from "../../types/capabilities";
import {
	type SearchableTool,
	searchableTools,
	searchTools,
	tokenize,
} from "../tool-search";

const TOOLS: SearchableTool[] = [
	{
		qualifiedName: "github.create_issue",
		id: "create_issue",
		remoteName: "create_issue",
		context: "github",
		description: "Open a new issue on a repository.",
	},
	{
		qualifiedName: "github.search_code",
		id: "search_code",
		remoteName: "search_code",
		context: "github",
		description: "Search code across repositories.",
	},
	{
		qualifiedName: "slack.post_message",
		id: "post_message",
		remoteName: "chat_postMessage",
		context: "slack",
		description: "Send a message to a Slack channel.",
	},
	{
		qualifiedName: "lint",
		id: "lint",
		description: "Run eslint over the workspace.",
	},
];

const names = (hits: ReturnType<typeof searchTools>) =>
	hits.map((h) => h.tool.qualifiedName);

describe("tokenize", () => {
	it("splits on anything that is not a letter or digit", () => {
		expect(tokenize("create_issue on GitHub!")).toEqual([
			"create",
			"issue",
			"on",
			"github",
		]);
	});
});

describe("searchTools", () => {
	it("finds a tool by a word in its name", () => {
		expect(names(searchTools(TOOLS, "issue"))).toEqual(["github.create_issue"]);
	});

	it("finds a tool by a word in its description", () => {
		expect(names(searchTools(TOOLS, "eslint"))).toEqual(["lint"]);
	});

	it("matches the remote name when the local id differs", () => {
		expect(names(searchTools(TOOLS, "postMessage"))).toContain(
			"slack.post_message",
		);
	});

	it("ranks a tool matching both terms above one matching either", () => {
		expect(names(searchTools(TOOLS, "search code"))[0]).toBe(
			"github.search_code",
		);
	});

	it("ranks an exact name match first", () => {
		expect(names(searchTools(TOOLS, "lint"))[0]).toBe("lint");
	});

	it("matches across a plural", () => {
		expect(names(searchTools(TOOLS, "repositories"))).toContain(
			"github.create_issue",
		);
	});

	it("returns nothing when no term matches", () => {
		expect(searchTools(TOOLS, "kubernetes helm")).toEqual([]);
	});

	it("lists tools alphabetically for an empty query", () => {
		expect(names(searchTools(TOOLS, "   "))).toEqual([
			"github.create_issue",
			"github.search_code",
			"lint",
			"slack.post_message",
		]);
	});

	it("respects the limit, and clamps a silly one", () => {
		expect(searchTools(TOOLS, "", 2)).toHaveLength(2);
		expect(searchTools(TOOLS, "", 0)).toHaveLength(4);
		expect(searchTools(TOOLS, "", 9999)).toHaveLength(4);
	});
});

describe("searchableTools", () => {
	it("carries the qualified name, remote name, and server for each tool", () => {
		const capabilities = {
			providers: [],
			options: {},
			skills: [],
			servers: [],
			tools: [
				{
					id: "search",
					type: "mcp",
					description: "Web search",
					def: { server: "@brave", tool: "brave_web_search" },
				},
				{
					id: "commit",
					type: "command",
					group: "git",
					def: { run: { cmd: "git", args: [] } },
				},
			],
		} as unknown as Capabilities;

		expect(searchableTools(capabilities)).toEqual([
			{
				qualifiedName: "brave.search",
				id: "search",
				remoteName: "brave_web_search",
				context: "brave",
				description: "Web search",
			},
			{
				qualifiedName: "git.commit",
				id: "commit",
				remoteName: undefined,
				context: "git",
				description: undefined,
			},
		]);
	});
});
