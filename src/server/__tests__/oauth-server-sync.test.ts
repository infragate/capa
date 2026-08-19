import { describe, expect, it } from "bun:test";
import type { Capabilities, MCPServer } from "../../types/capabilities";
import type { OAuth2Config } from "../../types/oauth";
import type { OAuth2Manager } from "../oauth-manager";
import {
	mergeDetectedOAuth2,
	syncServerOAuth2Requirement,
} from "../oauth-server-sync";
import { preserveDiscoveredOAuth2 } from "../resolve-effective-capabilities";

function mcpServer(
	id: string,
	url: string,
	oauth2?: OAuth2Config,
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
				mcpServer("server-a", "https://old.example/mcp", {
					authorizationEndpoint: "https://auth.example/authorize",
					tokenEndpoint: "https://auth.example/token",
				}),
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
				mcpServer("server-b", "https://mcp.example/mcp", {
					authorizationEndpoint: "https://auth.example/authorize",
					tokenEndpoint: "https://auth.example/token",
				}),
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
});

describe("mergeDetectedOAuth2", () => {
	it("keeps plugin-embedded client_id and callback_port", () => {
		const merged = mergeDetectedOAuth2(
			{ client_id: "embedded-app", callback_port: 3111 },
			{
				authorizationEndpoint: "https://auth.example/authorize",
				tokenEndpoint: "https://auth.example/token",
			},
		);
		expect(merged.client_id).toBe("embedded-app");
		expect(merged.callback_port).toBe(3111);
		expect(merged.authorizationEndpoint).toBe("https://auth.example/authorize");
	});
});

describe("syncServerOAuth2Requirement", () => {
	it("clears stale OAuth config when the live URL no longer requires auth", async () => {
		const server = mcpServer("server-a", "https://new.example/mcp", {
			authorizationEndpoint: "https://auth.example/authorize",
			tokenEndpoint: "https://auth.example/token",
		});
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
