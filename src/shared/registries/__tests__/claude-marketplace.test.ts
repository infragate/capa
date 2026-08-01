import { describe, it, expect } from "bun:test";
import {
	buildPluginInstallSnippet,
	buildRepoString,
	classifyMarketplaceSource,
	createClaudeMarketplaceAdapter,
	marketplaceIcon,
	marketplaceNameToSlug,
	parseClaudeMarketplaceSource,
	parseMarketplaceJson,
	siteFavicon,
	sourceToInstallCoords,
} from "../claude-marketplace";
import type { MarketplaceOrigin } from "../claude-marketplace";

const DEVELOPER_KIT_FIXTURE = {
	name: "developer-kit",
	version: "3.1.0",
	description: "Modular marketplace for developer kit plugins",
	owner: {
		name: "Giuseppe Trisciuoglio",
		email: "giuseppe.trisciuoglio@gmail.com",
	},
	plugins: [
		{
			name: "developer-kit",
			description: "Core agents and commands required by all plugins",
			source: "./plugins/developer-kit-core",
			version: "2.8.0",
		},
		{
			name: "developer-kit-typescript",
			description: "TypeScript/JavaScript full-stack development",
			source: "./plugins/developer-kit-typescript",
			version: "2.8.0",
		},
		{
			name: "developer-kit-ai",
			description: "AI/ML skills",
			source: "./plugins/developer-kit-ai",
			version: "2.8.0",
		},
	],
};

const ORIGIN: MarketplaceOrigin = {
	source: "giuseppe-trisciuoglio/developer-kit",
	host: "github",
	ownerRepo: "giuseppe-trisciuoglio/developer-kit",
};

describe("claude-marketplace parse", () => {
	it("parses the developer-kit marketplace fixture", () => {
		const catalog = parseMarketplaceJson(DEVELOPER_KIT_FIXTURE);
		expect(catalog.name).toBe("developer-kit");
		expect(catalog.plugins).toHaveLength(3);
		expect(catalog.owner?.name).toBe("Giuseppe Trisciuoglio");
		expect(marketplaceNameToSlug(catalog.name)).toBe("developer-kit");
	});

	it("applies metadata.pluginRoot when classifying relative sources", () => {
		const catalog = parseMarketplaceJson({
			name: "rooted",
			metadata: { pluginRoot: "./plugins" },
			plugins: [{ name: "formatter", source: "formatter" }],
		});
		expect(catalog.pluginRoot).toBe("plugins");
		const coords = sourceToInstallCoords(
			catalog.plugins[0].source,
			{ source: "acme/tools", host: "github", ownerRepo: "acme/tools" },
			catalog.pluginRoot,
		);
		expect(coords?.subpath).toBe("plugins/formatter");
	});

	it("rejects catalogs without plugins", () => {
		expect(() =>
			parseMarketplaceJson({ name: "empty", plugins: [] }),
		).toThrow(/no valid plugins/);
	});

	it("classifies npm and github object sources", () => {
		expect(classifyMarketplaceSource({ source: "npm", package: "@acme/p" })).toEqual({
			kind: "npm",
			package: "@acme/p",
			version: undefined,
		});
		expect(
			classifyMarketplaceSource({
				source: "github",
				repo: "acme/plugin",
				ref: "v1",
			}),
		).toEqual({
			kind: "repo",
			repo: "acme/plugin",
			ref: "v1",
			sha: undefined,
			commit: undefined,
		});
	});
});

describe("claude-marketplace source mapping", () => {
	it("maps matching basename to @ form", () => {
		const catalog = parseMarketplaceJson(DEVELOPER_KIT_FIXTURE);
		const ts = catalog.plugins.find((p) => p.name === "developer-kit-typescript")!;
		const snippet = buildPluginInstallSnippet(ts, catalog, ORIGIN);
		expect(snippet).toEqual({
			id: "developer-kit-typescript",
			type: "github",
			def: {
				repo: "giuseppe-trisciuoglio/developer-kit@developer-kit-typescript",
				description: ts.description,
			},
		});
	});

	it("maps mismatched basename to :: form", () => {
		const catalog = parseMarketplaceJson(DEVELOPER_KIT_FIXTURE);
		const core = catalog.plugins.find((p) => p.name === "developer-kit")!;
		const snippet = buildPluginInstallSnippet(core, catalog, ORIGIN);
		expect(snippet?.def.repo).toBe(
			"giuseppe-trisciuoglio/developer-kit::plugins/developer-kit-core",
		);
	});

	it("returns null for npm sources", () => {
		const catalog = parseMarketplaceJson({
			name: "mixed",
			plugins: [
				{
					name: "pkg",
					source: { source: "npm", package: "@acme/claude-plugin" },
				},
			],
		});
		expect(buildPluginInstallSnippet(catalog.plugins[0], catalog, ORIGIN)).toBeNull();
	});

	it("returns null for monorepo-local when origin has no ownerRepo", () => {
		const catalog = parseMarketplaceJson(DEVELOPER_KIT_FIXTURE);
		const snippet = buildPluginInstallSnippet(catalog.plugins[0], catalog, {
			source: "https://example.com/marketplace.json",
			host: "github",
			ownerRepo: null,
		});
		expect(snippet).toBeNull();
	});

	it("buildRepoString prefers @ when leaf matches plugin name", () => {
		expect(
			buildRepoString(
				{ host: "github", ownerRepo: "a/b", subpath: "plugins/foo" },
				"foo",
			),
		).toBe("a/b@foo");
		expect(
			buildRepoString(
				{ host: "github", ownerRepo: "a/b", subpath: "plugins/bar" },
				"foo",
			),
		).toBe("a/b::plugins/bar");
	});
});

describe("parseClaudeMarketplaceSource", () => {
	it("parses owner/repo and owner/repo@ref", () => {
		expect(parseClaudeMarketplaceSource("giuseppe-trisciuoglio/developer-kit")).toMatchObject({
			kind: "git",
			locator: "giuseppe-trisciuoglio/developer-kit",
			origin: {
				ownerRepo: "giuseppe-trisciuoglio/developer-kit",
				host: "github",
				baseUrl: "https://github.com",
			},
		});
		expect(
			parseClaudeMarketplaceSource("giuseppe-trisciuoglio/developer-kit@v3.1.0"),
		).toMatchObject({
			kind: "git",
			ref: "v3.1.0",
			locator: "giuseppe-trisciuoglio/developer-kit",
		});
	});

	it("parses a direct marketplace.json URL and recovers GitHub coords from raw.githubusercontent.com", () => {
		const parsed = parseClaudeMarketplaceSource(
			"https://raw.githubusercontent.com/giuseppe-trisciuoglio/developer-kit/main/.claude-plugin/marketplace.json",
		);
		expect(parsed.kind).toBe("json-url");
		expect(parsed.origin).toMatchObject({
			host: "github",
			ownerRepo: "giuseppe-trisciuoglio/developer-kit",
			baseUrl: "https://github.com",
		});
	});

	it("uses the site origin for unknown marketplace.json hosts", () => {
		const parsed = parseClaudeMarketplaceSource(
			"https://git.example.com/team/plugins/.claude-plugin/marketplace.json",
		);
		expect(parsed.origin).toMatchObject({
			host: "other",
			ownerRepo: null,
			baseUrl: "https://git.example.com",
		});
	});
});

describe("marketplaceIcon", () => {
	it("uses the GitHub owner avatar when host is github", () => {
		expect(
			marketplaceIcon({
				source: "acme/kit",
				host: "github",
				ownerRepo: "acme/kit",
				baseUrl: "https://github.com",
			}),
		).toBe("https://github.com/acme.png?size=64");
	});

	it("falls back to the site favicon for GitLab", () => {
		expect(
			marketplaceIcon({
				source: "https://gitlab.com/acme/kit",
				host: "gitlab",
				ownerRepo: "acme/kit",
				baseUrl: "https://gitlab.com",
			}),
		).toBe("https://gitlab.com/favicon.ico");
	});

	it("falls back to the site favicon for other git hosts", () => {
		expect(
			marketplaceIcon({
				source: "https://git.example.com/team/plugins/.claude-plugin/marketplace.json",
				host: "other",
				ownerRepo: null,
				baseUrl: "https://git.example.com",
			}),
		).toBe("https://git.example.com/favicon.ico");
	});

	it("siteFavicon rejects non-http URLs", () => {
		expect(siteFavicon("file:///tmp/x")).toBe("https://claude.com/favicon.ico");
	});
});

describe("createClaudeMarketplaceAdapter", () => {
	it("searches and views installable plugins", async () => {
		const catalog = parseMarketplaceJson(DEVELOPER_KIT_FIXTURE);
		const adapter = createClaudeMarketplaceAdapter({
			slug: "developer-kit",
			catalog,
			origin: ORIGIN,
		});

		expect(adapter.manifest.id).toBe("developer-kit");
		expect(adapter.manifest.capabilities).toEqual(["plugins"]);
		expect(adapter.manifest.icon).toBe(
			"https://github.com/giuseppe-trisciuoglio.png?size=64",
		);

		const search = await adapter.search({ capability: "plugins", query: "typescript" });
		expect(search.total).toBe(1);
		expect(search.items[0].id).toBe("developer-kit-typescript");
		expect(search.items[0].tags).toContain("source-resolved");

		const detail = await adapter.view({
			capability: "plugins",
			id: "developer-kit-typescript",
		});
		expect(detail.installSnippet).toMatchObject({
			id: "developer-kit-typescript",
			type: "github",
		});
		expect((detail.installSnippet as { def: { repo: string } }).def.repo).toContain(
			"@developer-kit-typescript",
		);
	});

	it("lists unsupported plugins in search but rejects view install", async () => {
		const catalog = parseMarketplaceJson({
			name: "mixed",
			plugins: [
				{
					name: "npm-only",
					source: { source: "npm", package: "@acme/x" },
				},
			],
		});
		const adapter = createClaudeMarketplaceAdapter({
			slug: "mixed",
			catalog,
			origin: ORIGIN,
		});
		const search = await adapter.search({ capability: "plugins" });
		expect(search.items[0].tags).toContain("source-unsupported");
		await expect(
			adapter.view({ capability: "plugins", id: "npm-only" }),
		).rejects.toThrow(/npm package/);
	});
});
