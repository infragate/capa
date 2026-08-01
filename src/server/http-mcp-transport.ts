import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import { shouldSkipTlsVerify } from "../shared/tls-skip-verify";
import type { MCPServerDefinition } from "../types/capabilities";
import type { OAuth2Config } from "../types/oauth";
import { MCPSessionExpiredError } from "./mcp-proxy-errors";
import type { OAuth2Manager } from "./oauth-manager";

/**
 * Parse Server-Sent Events (SSE) format response
 * Format: "event: message\ndata: {...}\n\n"
 */
export function parseSSEResponse(text: string): JSONRPCMessage | null {
	const lines = text.trim().split("\n");
	for (const line of lines) {
		if (line.startsWith("data: ")) {
			const jsonStr = line.substring(6).trim();
			try {
				return JSON.parse(jsonStr);
			} catch (error) {
				logger.error(`Failed to parse SSE data: ${jsonStr}`);
				return null;
			}
		}
	}
	return null;
}

/**
 * HTTP Transport for MCP with OAuth2 support and session management
 */
export class HttpMCPTransport implements Transport {
	private url: string;
	private projectId: string;
	private serverId: string;
	private db: CapaDatabase;
	private oauth2Manager: OAuth2Manager;
	private serverDefinition: MCPServerDefinition;
	private skipTlsVerify: boolean;
	private logger = logger.child("HttpTransport");
	public sessionId?: string;
	public onclose?: () => void;
	public onerror?: (error: Error) => void;
	public onmessage?: (message: JSONRPCMessage) => void;

	constructor(
		url: string,
		projectId: string,
		serverId: string,
		db: CapaDatabase,
		oauth2Manager: OAuth2Manager,
		serverDefinition: MCPServerDefinition,
	) {
		this.url = url;
		this.projectId = projectId;
		this.serverId = serverId;
		this.db = db;
		this.oauth2Manager = oauth2Manager;
		this.serverDefinition = serverDefinition;
		this.skipTlsVerify = shouldSkipTlsVerify(
			!!serverDefinition.tlsSkipVerify,
			`MCP HTTP transport (${serverId})`,
		);
	}

	async start(): Promise<void> {
		this.logger.debug(`Started for ${this.url}`);
	}

	async send(message: JSONRPCMessage): Promise<void> {
		try {
			this.logger.debug(`Sending message: ${JSON.stringify(message)}`);

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			};

			if (this.sessionId) {
				headers["mcp-session-id"] = this.sessionId;
			}

			if (this.serverDefinition.headers) {
				Object.assign(headers, this.serverDefinition.headers);
			}

			if (this.serverDefinition.oauth2) {
				const accessToken = await this.oauth2Manager.getAccessToken(
					this.projectId,
					this.serverId,
					this.serverDefinition.oauth2 as OAuth2Config,
				);
				if (accessToken) {
					headers["Authorization"] = `Bearer ${accessToken}`;
				}
			}

			const tlsOptions = this.skipTlsVerify
				? ({ tls: { rejectUnauthorized: false } } as object)
				: {};

			const response = await fetch(this.url, {
				method: "POST",
				headers,
				body: JSON.stringify(message),
				...tlsOptions,
			} as RequestInit);

			if (response.status === 401 && this.serverDefinition.oauth2) {
				this.logger.warn("401 Unauthorized, attempting token refresh");

				const refreshed = await this.oauth2Manager.refreshAccessToken(
					this.projectId,
					this.serverId,
					this.serverDefinition.oauth2 as OAuth2Config,
				);

				if (refreshed) {
					const newToken = await this.oauth2Manager.getAccessToken(
						this.projectId,
						this.serverId,
						this.serverDefinition.oauth2 as OAuth2Config,
					);
					if (newToken) {
						headers["Authorization"] = `Bearer ${newToken}`;
						const retryResponse = await fetch(this.url, {
							method: "POST",
							headers,
							body: JSON.stringify(message),
							...tlsOptions,
						} as RequestInit);

						if (retryResponse.ok) {
							const sessionId = retryResponse.headers.get("mcp-session-id");
							if (sessionId && !this.sessionId) {
								this.sessionId = sessionId;
								this.logger.info(`Session established: ${sessionId}`);
							}

							const contentType =
								retryResponse.headers.get("content-type") || "";
							let responseMessage: JSONRPCMessage;

							if (contentType.includes("text/event-stream")) {
								const text = await retryResponse.text();
								const parsed = parseSSEResponse(text);
								if (!parsed) {
									throw new Error("Failed to parse SSE response");
								}
								responseMessage = parsed;
							} else {
								responseMessage = await retryResponse.json();
							}

							if (this.onmessage) {
								this.onmessage(responseMessage);
							}
							return;
						}
					}
				}

				throw new Error("Authentication failed. Please reconnect OAuth2.");
			}

			if (response.status === 404 && this.sessionId) {
				this.logger.warn(
					`404 Not Found with active session ID - session likely expired, clearing session`,
				);
				this.sessionId = undefined;
				throw new MCPSessionExpiredError();
			}

			if (!response.ok) {
				let errorDetails = "";
				try {
					const contentType = response.headers.get("content-type") || "";
					if (contentType.includes("application/json")) {
						const errorJson = await response.json();
						errorDetails = `: ${JSON.stringify(errorJson)}`;
					} else {
						const errorText = await response.text();
						errorDetails = errorText ? `: ${errorText}` : "";
					}
				} catch (e) {
					// Ignore parsing errors
				}
				this.logger.error(
					`HTTP ${response.status}: ${response.statusText}${errorDetails}`,
				);
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}${errorDetails}`,
				);
			}

			const sessionId = response.headers.get("mcp-session-id");
			if (sessionId && !this.sessionId) {
				this.sessionId = sessionId;
				this.logger.info(`Session established: ${sessionId}`);
			}

			const contentType = response.headers.get("content-type") || "";
			let responseMessage: JSONRPCMessage;

			if (contentType.includes("text/event-stream")) {
				const text = await response.text();
				const parsed = parseSSEResponse(text);
				if (!parsed) {
					throw new Error("Failed to parse SSE response");
				}
				responseMessage = parsed;
			} else {
				responseMessage = await response.json();
			}

			if (this.onmessage) {
				this.onmessage(responseMessage);
			}
		} catch (error: any) {
			this.logger.error("Error sending message:", error);
			if (this.onerror) {
				this.onerror(error);
			}
			throw error;
		}
	}

	async close(): Promise<void> {
		this.logger.debug(`Closed for ${this.url}`);
		if (this.onclose) {
			this.onclose();
		}
	}
}
