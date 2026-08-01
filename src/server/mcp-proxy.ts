import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CapaDatabase } from "../db/database";
import { logger } from "../shared/logger";
import {
	hasUnresolvedVariables,
	resolveVariablesInObject,
} from "../shared/variable-resolver";
import type {
	MCPServerDefinition,
	ToolMCPDefinition,
} from "../types/capabilities";
import { VERSION } from "../version";
import { HttpMCPTransport } from "./http-mcp-transport";
import {
	MCPOAuthDisconnectedError,
	MCPSessionExpiredError,
} from "./mcp-proxy-errors";
import { OAuth2Manager } from "./oauth-manager";
import { HiddenStdioClientTransport as StdioClientTransport } from "./stdio-client-transport";

export {
	MCPOAuthDisconnectedError,
	MCPSessionExpiredError,
} from "./mcp-proxy-errors";

/** Timeout for MCP client.connect() — prevents hanging on an unresponsive server (ms). */
const MCP_CONNECT_TIMEOUT_MS = 15_000;

export interface MCPToolResult {
	success: boolean;
	result?: any;
	error?: string;
}

export class MCPProxy {
	private db: CapaDatabase;
	private projectId: string;
	private projectPath: string;
	private oauth2Manager: OAuth2Manager;
	private clients = new Map<string, Client>();
	/** Launch fingerprint for each cached client (cmd/args/env/cwd/url/…). */
	private clientFingerprints = new Map<string, string>();
	/** Last unexpected stdio exit reason per server (from transport onerror). */
	private stdioExitReasons = new Map<string, string>();
	private logger = logger.child("MCPProxy");

	constructor(db: CapaDatabase, projectId: string, projectPath: string) {
		this.db = db;
		this.projectId = projectId;
		this.projectPath = projectPath;
		this.oauth2Manager = new OAuth2Manager(db);
	}

	/**
	 * Execute a tool on a remote/child MCP server
	 */
	async executeTool(
		toolId: string,
		definition: ToolMCPDefinition,
		serverDefinition: MCPServerDefinition,
		args: Record<string, any>,
	): Promise<MCPToolResult> {
		// Strip @ prefix from server ID if present
		const serverId = definition.server.replace("@", "");

		this.logger.info(`Executing tool: ${toolId} on server: ${serverId}`);
		this.logger.debug(
			`Tool name: ${definition.tool}, Args: ${JSON.stringify(args)}`,
		);

		// Resolve variables in server definition
		const resolvedServerDef = resolveVariablesInObject(
			serverDefinition,
			this.projectId,
			this.db,
		);

		// Check for unresolved variables
		if (hasUnresolvedVariables(resolvedServerDef)) {
			this.logger.failure("Unresolved variables in server configuration");
			return {
				success: false,
				error:
					"Server configuration has unresolved variables. Please configure credentials.",
			};
		}

		// Get or create MCP client
		let client: Client | null;
		try {
			client = await this.getOrCreateClient(serverId, resolvedServerDef);
		} catch (error) {
			if (error instanceof MCPOAuthDisconnectedError) {
				this.logger.failure(error.message);
				return { success: false, error: error.message };
			}
			throw error;
		}

		if (!client) {
			this.logger.failure("Failed to get client");
			return {
				success: false,
				error: `Failed to connect to MCP server: ${serverId}`,
			};
		}

		try {
			this.logger.debug("Calling tool on MCP server...");
			const result = await client.callTool({
				name: definition.tool,
				arguments: args,
			});

			if (result.isError) {
				const errorText = formatMcpContentError(result.content);
				this.logger.failure(`Tool returned isError: ${errorText}`);
				return {
					success: false,
					error: errorText,
				};
			}

			this.logger.success("Tool call succeeded");
			return {
				success: true,
				result: result.content,
			};
		} catch (error: any) {
			if (error instanceof MCPSessionExpiredError) {
				this.logger.warn(
					`Session expired for ${serverId}, reconnecting and retrying tool call...`,
				);
				this.clients.delete(serverId);
				let freshClient: Client | null;
				try {
					freshClient = await this.getOrCreateClient(
						serverId,
						resolvedServerDef,
					);
				} catch (reconnectError) {
					if (reconnectError instanceof MCPOAuthDisconnectedError) {
						return { success: false, error: reconnectError.message };
					}
					throw reconnectError;
				}
				if (!freshClient) {
					return {
						success: false,
						error: `Failed to reconnect to MCP server: ${serverId}`,
					};
				}
				try {
					const retryResult = await freshClient.callTool({
						name: definition.tool,
						arguments: args,
					});
					if (retryResult.isError) {
						const errorText = formatMcpContentError(retryResult.content);
						this.logger.failure(
							`Tool returned isError after reconnect: ${errorText}`,
						);
						return { success: false, error: errorText };
					}
					this.logger.success("Tool call succeeded after reconnect");
					return { success: true, result: retryResult.content };
				} catch (retryError: any) {
					this.logger.failure(
						`Tool call failed after reconnect: ${retryError.message}`,
					);
					return {
						success: false,
						error: this.formatToolCallError(
							serverId,
							definition.tool,
							retryError,
						),
					};
				}
			}
			this.logger.failure(`Tool call failed: ${error.message}`);
			return {
				success: false,
				error: this.formatToolCallError(serverId, definition.tool, error),
			};
		}
	}

	/**
	 * List tools available on an MCP server.
	 *
	 * By default this is tolerant: connection/listing failures are logged and an
	 * empty array is returned so aggregate callers don't blow up on one bad server.
	 * Pass `throwOnError: true` (used by on-demand schema resolution) to surface
	 * the underlying failure to the caller instead. `timeoutMs` bounds the request
	 * so a hung server can't block indefinitely.
	 */
	async listTools(
		serverId: string,
		serverDefinition: MCPServerDefinition,
		options: { throwOnError?: boolean; timeoutMs?: number } = {},
	): Promise<any[]> {
		const { throwOnError = false, timeoutMs = 15000 } = options;
		// Strip @ prefix from server ID if present
		const cleanServerId = serverId.replace("@", "");

		const resolvedServerDef = resolveVariablesInObject(
			serverDefinition,
			this.projectId,
			this.db,
		);

		let client: Client | null;
		try {
			client = await this.getOrCreateClient(cleanServerId, resolvedServerDef);
		} catch (error) {
			if (error instanceof MCPOAuthDisconnectedError) {
				if (throwOnError) throw error;
				return [];
			}
			throw error;
		}
		if (!client) {
			if (throwOnError) {
				throw new Error(`Could not connect to MCP server "${cleanServerId}"`);
			}
			return [];
		}

		try {
			const result = await client.listTools(undefined, { timeout: timeoutMs });
			return result.tools;
		} catch (error) {
			if (error instanceof MCPSessionExpiredError) {
				this.logger.warn(
					`Session expired for ${cleanServerId}, reconnecting...`,
				);
				this.clients.delete(cleanServerId);
				let freshClient: Client | null;
				try {
					freshClient = await this.getOrCreateClient(
						cleanServerId,
						resolvedServerDef,
					);
				} catch (reconnectError) {
					if (reconnectError instanceof MCPOAuthDisconnectedError) {
						if (throwOnError) throw reconnectError;
						return [];
					}
					throw reconnectError;
				}
				if (!freshClient) {
					if (throwOnError) {
						throw new Error(
							`Could not reconnect to MCP server "${cleanServerId}"`,
						);
					}
					return [];
				}
				try {
					const result = await freshClient.listTools(undefined, {
						timeout: timeoutMs,
					});
					return result.tools;
				} catch (retryError) {
					this.logger.error(
						`Failed to list tools from ${cleanServerId} after reconnect:`,
						retryError,
					);
					if (throwOnError) throw retryError;
					return [];
				}
			}
			this.logger.error(`Failed to list tools from ${cleanServerId}:`, error);
			if (throwOnError) throw error;
			return [];
		}
	}

	private async getOrCreateClient(
		serverId: string,
		serverDefinition: MCPServerDefinition,
	): Promise<Client | null> {
		const fingerprint = mcpServerLaunchFingerprint(serverDefinition);
		const existing = this.clients.get(serverId);
		if (existing) {
			const cachedFp = this.clientFingerprints.get(serverId);
			if (cachedFp === fingerprint) {
				this.logger.debug(`Using existing MCP client for server: ${serverId}`);
				return existing;
			}
			this.logger.info(
				`MCP server ${serverId} config changed; respawning` +
					(cachedFp ? ` (${summarizeFingerprint(cachedFp)} → ${summarizeFingerprint(fingerprint)})` : ""),
			);
			await this.closeServer(serverId);
		}

		this.logger.info(`Creating new MCP client for server: ${serverId}`);

		// For local subprocess-based servers
		if (serverDefinition.cmd) {
			return await this.createStdioClient(
				serverId,
				serverDefinition,
				fingerprint,
			);
		}

		// For remote HTTP-based servers
		if (serverDefinition.url) {
			return await this.createHttpClient(
				serverId,
				serverDefinition,
				fingerprint,
			);
		}

		return null;
	}

	private async createHttpClient(
		serverId: string,
		serverDefinition: MCPServerDefinition,
		fingerprint: string,
	): Promise<Client | null> {
		// Surface OAuth-disconnect as a typed error rather than a bare `null`, so
		// on-demand callers (e.g. `capa sh <tool>`) can show "Authentication
		// failed" instead of the misleading "Could not connect." Tolerant callers
		// catch this and degrade silently, preserving the no-401-during-install
		// behavior that the original early-return guaranteed.
		if (
			serverDefinition.oauth2 &&
			!this.oauth2Manager.isServerConnected(this.projectId, serverId)
		) {
			this.logger.debug(
				`Skipping HTTP client for ${serverId} (OAuth2 required, not connected)`,
			);
			throw new MCPOAuthDisconnectedError(serverId);
		}

		try {
			this.logger.info(`Creating HTTP client for: ${serverId}`);
			this.logger.debug(`URL: ${serverDefinition.url}`);

			// Create HTTP transport with OAuth2 support
			const transport = new HttpMCPTransport(
				serverDefinition.url!,
				this.projectId,
				serverId,
				this.db,
				this.oauth2Manager,
				serverDefinition,
			);

			// Create client
			const client = new Client(
				{
					name: `capa-proxy-${serverId}`,
					version: VERSION,
				},
				{
					capabilities: {},
				},
			);

			client.onclose = () => {
				this.logger.info(`Client ${serverId} closed, removing from cache`);
				this.forgetClient(serverId);
			};

			this.logger.debug("Connecting client...");
			await this.connectWithTimeout(client, transport);

			this.clients.set(serverId, client);
			this.clientFingerprints.set(serverId, fingerprint);
			this.logger.success("Client connected");
			return client;
		} catch (error: any) {
			this.logger.failure(
				`Failed to create HTTP client for ${serverId}:`,
				error,
			);
			return null;
		}
	}

	private async createStdioClient(
		serverId: string,
		serverDefinition: MCPServerDefinition,
		fingerprint: string,
	): Promise<Client | null> {
		try {
			this.logger.info(`Creating stdio client for: ${serverId}`);
			this.logger.debug(
				`Command: ${serverDefinition.cmd}, Args: ${JSON.stringify(serverDefinition.args || [])}`,
			);

			const transport = new StdioClientTransport({
				command: serverDefinition.cmd!,
				args: serverDefinition.args || [],
				env: { ...process.env, ...serverDefinition.env } as Record<
					string,
					string
				>,
				cwd: serverDefinition.cwd ?? this.projectPath,
			});

			// Capture exit metadata before connect() wraps transport.onerror.
			this.stdioExitReasons.delete(serverId);
			transport.onerror = (error) => {
				const msg = error.message || String(error);
				if (/exited unexpectedly|panicked/i.test(msg)) {
					this.stdioExitReasons.set(serverId, msg);
				}
				this.logger.failure(`Stdio transport error for ${serverId}: ${msg}`);
			};

			const client = new Client(
				{
					name: `capa-proxy-${serverId}`,
					version: VERSION,
				},
				{
					capabilities: {},
				},
			);

			client.onclose = () => {
				this.logger.info(`Client ${serverId} closed, removing from cache`);
				this.forgetClient(serverId);
			};

			this.logger.debug("Connecting client...");
			await this.connectWithTimeout(client, transport);

			this.clients.set(serverId, client);
			this.clientFingerprints.set(serverId, fingerprint);
			this.logger.success("Client connected");
			return client;
		} catch (error) {
			this.logger.failure(
				`Failed to create MCP client for ${serverId}:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Prefer a descriptive stdio-exit reason over the SDK's generic
	 * "Connection closed" when the child died mid-request.
	 */
	private formatToolCallError(
		serverId: string,
		toolName: string,
		error: { message?: string; code?: number } | null | undefined,
	): string {
		const message = error?.message || "Tool execution failed";
		const exitReason = this.stdioExitReasons.get(serverId);
		const closed =
			error?.code === -32000 || // ErrorCode.ConnectionClosed in MCP SDK
			/connection closed/i.test(message);

		if (exitReason) {
			this.stdioExitReasons.delete(serverId);
			return `MCP server \`${serverId}\` exited unexpectedly while handling \`${toolName}\`: ${exitReason}`;
		}
		if (closed) {
			return `MCP server \`${serverId}\` connection closed while handling \`${toolName}\``;
		}
		if (
			error?.code === -32001 || // ErrorCode.RequestTimeout
			/timed out|timeout/i.test(message)
		) {
			return `MCP server \`${serverId}\` timed out while handling \`${toolName}\``;
		}
		return message;
	}

	/**
	 * Connect a client with a bounded timeout.
	 *
	 * `client.connect()` can hang indefinitely against an unreachable or
	 * half-open server (one that accepts the TCP connection but never completes
	 * the MCP handshake, e.g. it returns an empty response). We race the connect
	 * against a timer. Several subtleties matter so that a timeout never leaks a
	 * stray "MCP connect timed out" / "socket connection was closed unexpectedly"
	 * unhandled rejection out of the request and into the process/UI:
	 *
	 *  1. Attach a no-op `.catch` to the connect promise so that if it rejects
	 *     *after* we've already timed out (the socket closing late), that
	 *     rejection is considered handled.
	 *  2. Always clear the timer in `finally` — including when `client.connect()`
	 *     throws synchronously — so the timeout promise can't reject into the void
	 *     and trip the global unhandledRejection handler ~`timeoutMs` later.
	 *  3. On timeout, best-effort tear down the half-open client/transport so its
	 *     underlying socket doesn't linger and emit further errors.
	 *
	 * Rejections from this method are expected to be caught by the caller
	 * (`createHttpClient` / `createStdioClient`), which log and return `null`.
	 */
	private async connectWithTimeout(
		client: Client,
		transport: Transport,
		timeoutMs: number = MCP_CONNECT_TIMEOUT_MS,
	): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;

		try {
			const connectPromise = client.connect(transport);
			// Swallow a late rejection (socket closed after we already timed out) so
			// it doesn't surface as an unhandled rejection on the process.
			connectPromise.catch(() => {});

			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					reject(new Error(`MCP connect timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			});

			await Promise.race([connectPromise, timeout]);
		} catch (error) {
			if (timedOut) {
				// Best-effort cleanup of the half-open connection so the dangling
				// socket doesn't keep the process busy or emit late errors.
				try {
					await client.close();
				} catch {
					/* ignore */
				}
				try {
					await transport.close?.();
				} catch {
					/* ignore */
				}
			}
			throw error;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	/**
	 * Close a single cached MCP client (stdio child or HTTP session).
	 */
	async closeServer(serverId: string): Promise<void> {
		const client = this.clients.get(serverId);
		this.forgetClient(serverId);
		this.stdioExitReasons.delete(serverId);
		if (!client) return;
		try {
			await client.close();
		} catch (error) {
			this.logger.error(`Error closing client ${serverId}:`, error);
		}
	}

	/**
	 * Drop cached clients that were removed from capabilities, or whose
	 * launch fingerprint changed between `previousServers` and `servers`.
	 * Unchanged servers stay warm. Call-site fingerprinting in
	 * getOrCreateClient still catches resolved-def drift (e.g. secret edits).
	 */
	async syncCachedServers(
		servers: Array<{ id: string; def: MCPServerDefinition }>,
		previousServers?: Array<{ id: string; def: MCPServerDefinition }>,
	): Promise<void> {
		const wanted = new Map(
			servers.map((s) => [s.id, mcpServerLaunchFingerprint(s.def)]),
		);
		const previous = new Map(
			(previousServers ?? []).map((s) => [
				s.id,
				mcpServerLaunchFingerprint(s.def),
			]),
		);

		for (const serverId of [...this.clients.keys()]) {
			const nextFp = wanted.get(serverId);
			if (nextFp === undefined) {
				this.logger.info(
					`MCP server ${serverId} removed from capabilities; closing client`,
				);
				await this.closeServer(serverId);
				continue;
			}
			const prevFp = previous.get(serverId);
			if (prevFp !== undefined && prevFp !== nextFp) {
				this.logger.info(
					`MCP server ${serverId} config changed on configure; closing client (${summarizeFingerprint(prevFp)} → ${summarizeFingerprint(nextFp)})`,
				);
				await this.closeServer(serverId);
			}
		}
	}

	private forgetClient(serverId: string): void {
		this.clients.delete(serverId);
		this.clientFingerprints.delete(serverId);
	}

	/**
	 * Close all clients
	 */
	async closeAll(): Promise<void> {
		const ids = [...this.clients.keys()];
		for (const serverId of ids) {
			await this.closeServer(serverId);
		}
	}
}

/** Stable fingerprint of the launch config used to connect an MCP server. */
export function mcpServerLaunchFingerprint(def: MCPServerDefinition): string {
	const sorted = (obj: Record<string, string> | undefined) =>
		obj
			? Object.fromEntries(
					Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
				)
			: null;
	return JSON.stringify({
		cmd: def.cmd ?? null,
		args: def.args ?? null,
		env: sorted(def.env),
		cwd: def.cwd ?? null,
		url: def.url ?? null,
		headers: sorted(def.headers),
		tlsSkipVerify: def.tlsSkipVerify ?? false,
	});
}

function summarizeFingerprint(fingerprint: string): string {
	try {
		const parsed = JSON.parse(fingerprint) as {
			cmd?: string | null;
			args?: string[] | null;
			url?: string | null;
		};
		if (parsed.cmd) {
			const args = Array.isArray(parsed.args) ? parsed.args.join(" ") : "";
			return `${parsed.cmd} ${args}`.trim();
		}
		if (parsed.url) return parsed.url;
	} catch {
		/* ignore */
	}
	return fingerprint.slice(0, 80);
}

/** Flatten MCP tool content blocks into a single error string for traces/clients. */
function formatMcpContentError(content: unknown): string {
	if (typeof content === "string" && content.trim()) return content;
	if (Array.isArray(content)) {
		const parts = content
			.map((item) => {
				if (!item || typeof item !== "object") return null;
				const text = (item as { text?: unknown }).text;
				return typeof text === "string" ? text : null;
			})
			.filter((t): t is string => !!t && t.length > 0);
		if (parts.length > 0) return parts.join("\n");
	}
	try {
		return JSON.stringify(content) || "Tool returned an error";
	} catch {
		return "Tool returned an error";
	}
}
