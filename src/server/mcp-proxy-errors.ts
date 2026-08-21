export class MCPSessionExpiredError extends Error {
	constructor() {
		super("MCP session expired or not found");
		this.name = "MCPSessionExpiredError";
	}
}

/**
 * Thrown from `createHttpClient` when an OAuth2-protected server has no
 * active connection. Tolerant callers (install-time validation, default
 * `listTools`) catch this and degrade silently — so a disconnected server
 * doesn't spam 401s. On-demand callers (an explicit `capa sh` tool call,
 * `listTools` with `throwOnError`) rethrow it as a user-facing
 * "Authentication failed" instead of the misleading "Could not connect."
 */
export class MCPOAuthDisconnectedError extends Error {
	constructor(public readonly serverId: string) {
		super(`Authentication failed for "${serverId}". Please reconnect OAuth2.`);
		this.name = "MCPOAuthDisconnectedError";
	}
}

/** Thrown when a connect/list/execute is attempted on a server the user has not enabled. */
export class MCPServerDisabledError extends Error {
	constructor(public readonly serverId: string) {
		super(
			`MCP server "${serverId}" is off. Enable it in the project UI to use its tools.`,
		);
		this.name = "MCPServerDisabledError";
	}
}

/** Thrown when a stdio MCP launch is not on the project allowlist. */
export class MCPStdioUntrustedError extends Error {
	constructor(public readonly serverId: string) {
		super(
			`Cannot start stdio MCP server "${serverId}": launch command is not approved for this project.`,
		);
		this.name = "MCPStdioUntrustedError";
	}
}
