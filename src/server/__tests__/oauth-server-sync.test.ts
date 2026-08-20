import { describe, expect, it } from "bun:test";
import type { Capabilities, MCPServer } from "../../types/capabilities";
import type { OAuth2Config } from "../../types/oauth";
import type { OAuth2Manager } from "../oauth-manager";
import {
	mergeDetectedOAuth2,
	mergeEmbeddedOAuthFields,
	mergePluginEmbeddedOAuth,
	syncServerOAuth2Requirement,
} from "../oauth-server-sync";
import { preserveDiscoveredOAuth2 } from "../resolve-effective-capabilities";

const DETECTED_OAUTH: OAuth2Config = {
	authorizationEndpoint: "https://auth.example/authorize",
	tokenEndpoint: "https://auth.example/token",
	resourceServer: "https://mcp.example/mcp",
};

function mcpServer(
	id: string,
	url: string,
	oauth2?: Capabilities["servers"][number]["def"]["oauth2"],
): MCPServer {
	return {
		id,
		type: "mcp",
		def: { url, ...(oauth2 ? { oauth2 } : {}) },
	};
}

describe("preserveDiscoveredOAuth2", () => {
	it("does not copy OAuth metadata when the server URL changed", () => {
		const previous: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [
				mcpServer("server-a", "https://old.example/mcp", DETECTED_OAUTH),
			],
		};
		const fresh: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [mcpServer("server-a", "https://new.example/mcp")],
		};

		const result = preserveDiscoveredOAuth2(fresh, previous);
		expect(result.servers[0].def.oauth2).toBeUndefined();
	});

	it("still copies discovered endpoints when the URL is unchanged", () => {
		const previous: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [
				mcpServer("server-b", "https://mcp.example/mcp", DETECTED_OAUTH),
			],
		};
		const fresh: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [mcpServer("server-b", "https://mcp.example/mcp")],
		};

		const result = preserveDiscoveredOAuth2(fresh, previous);
		expect(result.servers[0].def.oauth2?.authorizationEndpoint).toBe(
			"https://auth.example/authorize",
		);
	});

	it("keeps plugin-embedded clientId when copying discovered endpoints", () => {
		const previous: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [
				mcpServer("slack", "https://mcp.example/mcp", DETECTED_OAUTH),
			],
		};
		const fresh: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [
				mcpServer("slack", "https://mcp.example/mcp", {
					clientId: "plugin-app-id",
					callbackPort: 3118,
				}),
			],
		};

		const result = preserveDiscoveredOAuth2(fresh, previous);
		expect(result.servers[0].def.oauth2?.clientId).toBe("plugin-app-id");
		expect(result.servers[0].def.oauth2?.callbackPort).toBe(3118);
		expect(result.servers[0].def.oauth2?.authorizationEndpoint).toBe(
			"https://auth.example/authorize",
		);
	});
});

describe("mergeDetectedOAuth2", () => {
	it("keeps plugin-embedded clientId and callbackPort", () => {
		const merged = mergeDetectedOAuth2(
			{ clientId: "embedded-app", callbackPort: 3111 },
			DETECTED_OAUTH,
		);
		expect(merged.clientId).toBe("embedded-app");
		expect(merged.callbackPort).toBe(3111);
		expect(merged.authorizationEndpoint).toBe("https://auth.example/authorize");
	});
});

describe("mergeEmbeddedOAuthFields", () => {
	it("does not copy clientSecret from embedded oauth", () => {
		const merged = mergeEmbeddedOAuthFields(
			{ authorizationEndpoint: "https://auth.example/authorize" },
			{
				clientId: "plugin-app-id",
				clientSecret: "top-secret",
			},
		);
		expect(merged?.clientId).toBe("plugin-app-id");
		expect(merged?.clientSecret).toBeUndefined();
	});
});

describe("mergePluginEmbeddedOAuth", () => {
	it("restores plugin clientId onto session capabilities missing embedded fields", () => {
		const session: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [
				mcpServer("slack", "https://mcp.example/mcp", DETECTED_OAUTH),
			],
		};
		const plugins: Capabilities = {
			providers: [],
			skills: [],
			tools: [],
			servers: [
				mcpServer("slack", "https://mcp.example/mcp", {
					clientId: "plugin-app-id",
					callbackPort: 3118,
				}),
			],
		};

		mergePluginEmbeddedOAuth(session, plugins);
		expect(session.servers[0].def.oauth2?.clientId).toBe("plugin-app-id");
		expect(session.servers[0].def.oauth2?.callbackPort).toBe(3118);
		expect(session.servers[0].def.oauth2?.authorizationEndpoint).toBe(
			"https://auth.example/authorize",
		);
	});
});

describe("syncServerOAuth2Requirement", () => {
	it("clears stale OAuth config when the live URL no longer requires auth", async () => {
		const server = mcpServer(
			"server-a",
			"https://new.example/mcp",
			DETECTED_OAUTH,
		);
		const disconnects: string[] = [];
		const oauth2Manager = {
			detectOAuth2Requirement: async () => null,
			isServerConnected: () => true,
			getAccessToken: async () => "token",
			disconnect: (_projectId: string, serverId: string) => {
				disconnects.push(serverId);
			},
		} as unknown as OAuth2Manager;

		const result = await syncServerOAuth2Requirement(
			"proj-1",
			server,
			oauth2Manager,
		);

		expect(result.changed).toBe(true);
		expect(result.entry).toBeNull();
		expect(server.def.oauth2).toBeUndefined();
		expect(disconnects).toEqual(["server-a"]);
	});
});
