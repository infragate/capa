import { existsSync, writeFileSync } from "fs";
// Import the React SPA bundle as text at compile time - this bundles it into the binary
import spaHtml from "../../web-ui/dist/index.html" with { type: "text" };
import { CapaDatabase } from "../db/database";
import {
	ensureCapaDir,
	getDatabasePath,
	getPidFilePath,
	loadSettings,
} from "../shared/config";
import { logger } from "../shared/logger";
import { RegistryManager } from "../shared/registries/manager";
import { seedDefaultRegistries } from "../shared/registries/seed";
import { isUnderWrapWorkspacesDir } from "../shared/workspaces/paths";
import type { Capabilities } from "../types/capabilities";
import { getSecretStorageTier } from "../shared/secret-crypto";
import { VERSION } from "../version";
import { type ActivityRouteDeps, dispatchActivity } from "./activity-routes";
import { authorizeApiRequest, injectHtmlAuthToken } from "./api-guards";
import {
	getSpaAuthToken,
	initAuth,
	isLoopbackHost,
	requireMcpAuth,
} from "./auth-middleware";
import { handleCapabilitiesMutation } from "./capabilities-routes";
import { CapabilitiesFileWatcher } from "./capabilities-watcher";
import {
	applyProjectCapabilitiesOnly,
	type ConfigureRouteDeps,
	dispatchConfigure,
	runProjectConfigure,
} from "./configure-routes";
import { isAllowedOrigin } from "./cors-origin";
import { GitIntegrationManager } from "./git-integration-manager";
import {
	dispatchGitIntegrations,
	type GitIntegrationsRouteDeps,
} from "./git-integrations-routes";
import { withAllowedHost } from "./host-allowlist";
import { htmlSecurityHeaders } from "./html-security-headers";
import { matchRoute } from "./match-route";
import { CapaMCPServer } from "./mcp-handler";
import { handleMcpHttp, type McpHttpRouteDeps } from "./mcp-http-routes";
import { dispatchMcpMeta, type McpMetaRouteDeps } from "./mcp-meta-routes";
import { McpServerStateManager } from "./mcp-server-state";
import { OAuth2Manager } from "./oauth-manager";
import {
	closeAllOAuthCallbackServers,
	dispatchOAuth,
	type OAuthRouteDeps,
} from "./oauth-routes";
import {
	dispatchProjects,
	notifyProjectChanged,
	notifyToolCall,
	type ProjectRouteDeps,
	reloadProjectCapabilitiesFromDisk,
} from "./project-routes";
import {
	dispatchRegistries,
	type RegistriesRouteDeps,
} from "./registries-routes";
import { type EffectiveCapsCacheEntry } from "./resolve-effective-capabilities";
import { SessionManager } from "./session-manager";
import { SubprocessManager } from "./subprocess-manager";
import {
	dispatchTokenRefresh,
	type TokenRefreshRouteDeps,
} from "./token-refresh-routes";
import { TokenRefreshScheduler } from "./token-refresh-scheduler";
import { ToolCallTracer } from "./tool-call-tracer";
import { dispatchVariables, type VariablesRouteDeps } from "./variables-routes";

class CapaServer {
	private db!: CapaDatabase;
	private sessionManager!: SessionManager;
	private subprocessManager!: SubprocessManager;
	private oauth2Manager!: OAuth2Manager;
	private gitIntegrationManager!: GitIntegrationManager;
	private tokenRefreshScheduler!: TokenRefreshScheduler;
	private settings: any;
	private mcpServers = new Map<string, CapaMCPServer>();
	private registryManager!: RegistryManager;
	private capsWatcher!: CapabilitiesFileWatcher;
	private toolCallTracer!: ToolCallTracer;
	private projectEventClients = new Map<
		string,
		Set<(chunk: Uint8Array) => void>
	>();
	/** Cached plugin-expanded capabilities keyed by project id */
	private effectiveCapsCache = new Map<string, EffectiveCapsCacheEntry>();
	private mcpServerStateManager = new McpServerStateManager();
	private startTime: number = Date.now();
	private logger = logger.child("CapaServer");

	private configureRouteDeps(): ConfigureRouteDeps {
		return {
			db: this.db,
			sessionManager: this.sessionManager,
			oauth2Manager: this.oauth2Manager,
			capsWatcher: this.capsWatcher,
			effectiveCapsCache: this.effectiveCapsCache,
			getOrCreateMCPServer: (id) => this.getOrCreateMCPServer(id),
			uiOrigin: () => this.uiOrigin(),
			syncProjectMcpClients: (projectId, servers, previousServers) =>
				this.syncProjectMcpClients(projectId, servers, previousServers),
			mcpServerState: this.mcpServerStateManager,
		};
	}

	/** Invalidate cached MCP children for a project after capabilities change. */
	private async syncProjectMcpClients(
		projectId: string,
		servers: Capabilities["servers"],
		previousServers?: Capabilities["servers"],
	): Promise<void> {
		for (const [key, mcp] of this.mcpServers) {
			if (key === projectId || key.startsWith(`${projectId}:`)) {
				await mcp.syncCachedMcpClients(servers, previousServers);
			}
		}
	}

	private projectRouteDeps(): ProjectRouteDeps {
		return {
			db: this.db,
			sessionManager: this.sessionManager,
			oauth2Manager: this.oauth2Manager,
			capsWatcher: this.capsWatcher,
			effectiveCapsCache: this.effectiveCapsCache,
			projectEventClients: this.projectEventClients,
			configureDeps: this.configureRouteDeps(),
			mcpServerState: this.mcpServerStateManager,
		};
	}

	private variablesRouteDeps(): VariablesRouteDeps {
		return {
			db: this.db,
			sessionManager: this.sessionManager,
		};
	}

	private mcpMetaRouteDeps(): McpMetaRouteDeps {
		return {
			db: this.db,
			sessionManager: this.sessionManager,
			getOrCreateMCPServer: (id) => this.getOrCreateMCPServer(id),
			mcpServerState: this.mcpServerStateManager,
		};
	}

	private tokenRefreshRouteDeps(): TokenRefreshRouteDeps {
		return {
			tokenRefreshScheduler: this.tokenRefreshScheduler,
		};
	}

	private gitIntegrationsRouteDeps(): GitIntegrationsRouteDeps {
		return {
			gitIntegrationManager: this.gitIntegrationManager,
			uiOrigin: () => this.uiOrigin(),
			serverHost: this.settings.server.host,
			serverPort: this.settings.server.port,
		};
	}

	private oauthRouteDeps(): OAuthRouteDeps {
		return {
			db: this.db,
			sessionManager: this.sessionManager,
			oauth2Manager: this.oauth2Manager,
			serverHost: this.settings.server.host,
			serverPort: this.settings.server.port,
			uiOrigin: () => this.uiOrigin(),
			effectiveCapsCache: this.effectiveCapsCache,
		};
	}

	private activityRouteDeps(): ActivityRouteDeps {
		return {
			...this.projectRouteDeps(),
			toolCallTracer: this.toolCallTracer,
		};
	}

	private registriesRouteDeps(): RegistriesRouteDeps {
		return {
			db: this.db,
			registryManager: this.registryManager,
			logger: this.logger,
		};
	}

	private mcpHttpRouteDeps(): McpHttpRouteDeps {
		return {
			mcpServers: this.mcpServers,
			db: this.db,
			sessionManager: this.sessionManager,
			toolCallTracer: this.toolCallTracer,
			mcpServerStateManager: this.mcpServerStateManager,
			serverHost: this.settings.server.host,
			serverPort: this.settings.server.port,
			logger: this.logger,
		};
	}

	async start() {
		this.logger.info("Starting CAPA server...");

		// Load settings
		this.settings = await loadSettings();

		// Ensure .capa directory exists
		await ensureCapaDir();

		// Initialize database
		const dbPath = getDatabasePath(this.settings);
		this.db = new CapaDatabase(dbPath);

		// Cleanup projects whose directories no longer exist
		await this.cleanupMissingProjects();

		// Initialize managers
		this.registryManager = new RegistryManager(this.db);

		// First-run seeding of the bundled example registries. This runs in the
		// background — a slow or unauthenticated GitHub fetch must not block
		// server startup, and any per-seed failure is persisted as a `failed`
		// row that the user can see and retry from the UI.
		void seedDefaultRegistries(this.db, this.registryManager, {
			log: {
				info: (m) => this.logger.info(m),
				warn: (m) => this.logger.warn(m),
				success: (m) => this.logger.success(m),
			},
		}).catch((err) => {
			this.logger.warn(
				`Default registry seeding failed: ${err?.message ?? err}`,
			);
		});

		this.sessionManager = new SessionManager(this.db);
		this.subprocessManager = new SubprocessManager(this.db);
		this.oauth2Manager = new OAuth2Manager(this.db);
		this.gitIntegrationManager = new GitIntegrationManager(this.db);
		this.toolCallTracer = new ToolCallTracer(this.db, (projectId, record) => {
			notifyToolCall(this.projectEventClients, projectId, record);
		});

		// Connect OAuth2Manager with SessionManager for capabilities access
		this.oauth2Manager.setCapabilitiesProvider(() =>
			this.sessionManager.getAllProjectCapabilities(),
		);

		// Initialize and start token refresh scheduler
		const checkInterval =
			(this.settings.token_refresh?.check_interval_seconds ?? 60) * 1000;
		const refreshThreshold =
			(this.settings.token_refresh?.refresh_threshold_seconds ?? 600) * 1000;

		this.tokenRefreshScheduler = new TokenRefreshScheduler(
			this.db,
			this.oauth2Manager,
			{
				checkInterval,
				refreshThreshold,
			},
		);
		this.tokenRefreshScheduler.setCapabilitiesProvider(() =>
			this.sessionManager.getAllProjectCapabilities(),
		);
		this.tokenRefreshScheduler.setGitIntegrationManager(
			this.gitIntegrationManager,
		);
		this.tokenRefreshScheduler.start();
		this.logger.success("Token refresh scheduler started");

		// Keep in-memory capabilities + UI in sync with on-disk edits
		this.capsWatcher = new CapabilitiesFileWatcher(
			(projectId) => this.reloadProjectCapabilitiesFromDisk(projectId),
			{
				info: (m) => this.logger.info(m),
				warn: (m) => this.logger.warn(m),
				debug: (m) => this.logger.debug(m),
			},
		);

		// Start HTTP server
		await this.startHttpServer();

		// Note: OAuth redirect server is started on-demand during OAuth flows

		// Write PID file
		this.writePidFile();

		// Watch all known projects' capabilities files
		for (const project of this.db.getAllProjects()) {
			void this.capsWatcher.watchProject(project.id, project.path);
		}

		this.logger.success(
			`CAPA server running at http://${this.settings.server.host}:${this.settings.server.port}`,
		);
		this.logger.info(
			`OAuth redirect server will start on-demand at http://${this.settings.server.host}:${this.settings.oauth_redirect_port || 3100}`,
		);
		this.logger.info(`Version: ${VERSION}`);
	}

	private async cleanupMissingProjects(): Promise<void> {
		const projects = this.db.getAllProjects();
		let removed = 0;
		for (const project of projects) {
			if (isUnderWrapWorkspacesDir(project.path)) {
				this.logger.warn(
					`Removing shadow wrap workspace project "${project.id}" at path: ${project.path}`,
				);
				this.db.deleteProject(project.id);
				removed++;
				continue;
			}
			if (!existsSync(project.path)) {
				this.logger.warn(
					`Project directory not found, removing project "${project.id}" at path: ${project.path}`,
				);
				this.db.deleteProject(project.id);
				removed++;
			}
		}
		if (removed > 0) {
			this.logger.info(
				`Removed ${removed} invalid project(s) (missing dirs or wrap shadows)`,
			);
		} else {
			this.logger.debug("All configured projects have valid directories");
		}
	}

	private authFailureResponse(
		request: Request,
		reason: string,
		status: number,
	): Response {
		const requestOrigin = request.headers.get("Origin");
		const originCheck = isAllowedOrigin(
			requestOrigin,
			this.settings.server.host,
			this.settings.server.port,
		);
		const headers: Record<string, string> = {};
		if (originCheck.origin) {
			headers["Access-Control-Allow-Origin"] = originCheck.origin;
		}
		return new Response(reason, { status, headers });
	}

	private async startHttpServer() {
		const { host, port } = this.settings.server;
		const self = this;

		const authToken = initAuth(host);
		if (authToken && !isLoopbackHost(host)) {
			process.stderr.write(`capa: auth token = ${authToken}\n`);
			process.stderr.write(
				"capa: clients must send `Authorization: Bearer <token>` to /api/* and the MCP route\n",
			);
		}

		const server = Bun.serve({
			hostname: host,
			port: port,
			async fetch(request, server) {
				return await self.handleRequest(request, server);
			},
		});

		this.logger.info(`HTTP server listening on ${host}:${port}`);
	}

	private async handleRequest(
		request: Request,
		server: any,
	): Promise<Response> {
		try {
			return await this._handleRequest(request, server);
		} catch (error: any) {
			this.logger.failure(
				`Unhandled error in request handler: ${error?.message ?? error}`,
			);
			return new Response(JSON.stringify({ error: "Internal server error" }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

	private async _handleRequest(
		request: Request,
		server: any,
	): Promise<Response> {
		return withAllowedHost(
			request,
			this.settings.server.host,
			this.settings.server.port,
			() => this._dispatchRequest(request, server),
		);
	}

	private async _dispatchRequest(
		request: Request,
		server: any,
	): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		this.logger.http(request.method, path);

		// Health check
		if (path === "/health") {
			this.logger.debug("Health check");
			const uptime = (Date.now() - this.startTime) / 1000; // uptime in seconds
			return new Response(
				JSON.stringify({
					status: "ok",
					version: VERSION,
					uptime: uptime,
					secretStorage: { tier: getSecretStorageTier() },
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}

		// SPA routes: home page and all /ui/* paths
		if (path === "/" || path === "/ui" || path.startsWith("/ui/")) {
			this.logger.debug("SPA");
			return this.handleSpa();
		}

		// API endpoints
		if (path.startsWith("/api/")) {
			this.logger.debug("API endpoint");
			if (request.method === "OPTIONS") {
				return new Response(null, { status: 204 });
			}
			const gate = authorizeApiRequest(request, {
				host: this.settings.server.host,
				port: this.settings.server.port,
			});
			if (!gate.ok) {
				return this.authFailureResponse(request, gate.reason, gate.status);
			}
			return this.handleAPI(request, server);
		}

		// Sub-agent MCP endpoints: /{projectId}/agents/{agentId}/mcp
		const agentMcp = matchRoute(path, "/:projectId/agents/:agentId/mcp");
		if (agentMcp) {
			const { projectId, agentId } = agentMcp;
			this.logger.debug(
				`MCP endpoint for project: ${projectId}, sub-agent: ${agentId}`,
			);
			const auth = requireMcpAuth(request, this.settings.server.host);
			if (!auth.ok) {
				return this.authFailureResponse(request, auth.reason, auth.status);
			}
			return handleMcpHttp(
				this.mcpHttpRouteDeps(),
				request,
				projectId,
				agentId,
			);
		}

		// Main MCP endpoints: /{projectId}/mcp
		const mcp = matchRoute(path, "/:projectId/mcp");
		if (mcp) {
			const { projectId } = mcp;
			this.logger.debug(`MCP endpoint for project: ${projectId}`);
			const auth = requireMcpAuth(request, this.settings.server.host);
			if (!auth.ok) {
				return this.authFailureResponse(request, auth.reason, auth.status);
			}
			return handleMcpHttp(this.mcpHttpRouteDeps(), request, projectId);
		}

		this.logger.debug("404 Not Found");
		return new Response("Not Found", { status: 404 });
	}

	private async handleSpa(): Promise<Response> {
		const html = injectHtmlAuthToken(
			spaHtml as unknown as string,
			getSpaAuthToken(),
		);
		return new Response(html, {
			headers: htmlSecurityHeaders({ "Content-Type": "text/html" }),
		});
	}

	private async handleAPI(
		request: Request,
		bunServer?: { timeout?: (req: Request, seconds: number) => void },
	): Promise<Response> {
		const path = new URL(request.url).pathname;
		const method = request.method;

		const projects = await dispatchProjects(
			this.projectRouteDeps(),
			path,
			method,
			request,
			bunServer,
		);
		if (projects) return projects;

		const activity = await dispatchActivity(
			this.activityRouteDeps(),
			path,
			method,
			request,
		);
		if (activity) return activity;

		const configure = await dispatchConfigure(
			this.configureRouteDeps(),
			path,
			method,
			request,
		);
		if (configure) return configure;

		const variables = await dispatchVariables(
			this.variablesRouteDeps(),
			path,
			method,
			request,
		);
		if (variables) return variables;

		const caps = matchRoute(path, "/api/projects/:projectId/capabilities*");
		if (caps) {
			const projectId = caps.projectId;
			const mutation = await handleCapabilitiesMutation(
				{
					db: this.db,
					registryManager: this.registryManager,
					configure: (id, capsBody) => this._runProjectConfigure(id, capsBody),
					refreshCapabilities: (id, capsBody) =>
						this._refreshProjectCapabilities(id, capsBody),
					markSelfWrite: (id) => this.capsWatcher.markSelfWrite(id),
					notifyChanged: (id) => this.notifyProjectChanged(id),
				},
				projectId,
				path,
				method,
				request,
			);
			if (mutation) return mutation;
		}

		const oauth = await dispatchOAuth(
			this.oauthRouteDeps(),
			path,
			method,
			request,
		);
		if (oauth) return oauth;

		const mcpMeta = await dispatchMcpMeta(
			this.mcpMetaRouteDeps(),
			path,
			method,
			request,
		);
		if (mcpMeta) return mcpMeta;

		const tokenRefresh = await dispatchTokenRefresh(
			this.tokenRefreshRouteDeps(),
			path,
			method,
		);
		if (tokenRefresh) return tokenRefresh;

		const git = await dispatchGitIntegrations(
			this.gitIntegrationsRouteDeps(),
			path,
			method,
			request,
		);
		if (git) return git;

		const registries = await dispatchRegistries(
			this.registriesRouteDeps(),
			path,
			method,
			request,
		);
		if (registries) return registries;

		return new Response("Not Found", { status: 404 });
	}

	private getOrCreateMCPServer(
		projectId: string,
		agentId?: string,
	): CapaMCPServer | null {
		const cacheKey = agentId ? `${projectId}:${agentId}` : projectId;
		let mcpServer = this.mcpServers.get(cacheKey);
		if (mcpServer) return mcpServer;

		const project = this.db.getProject(projectId);
		if (!project) return null;

		mcpServer = new CapaMCPServer(
			this.db,
			this.sessionManager,
			projectId,
			project.path,
			agentId,
			this.toolCallTracer,
			this.mcpServerStateManager,
		);
		this.mcpServers.set(cacheKey, mcpServer);
		return mcpServer;
	}

	private _runProjectConfigure(
		projectId: string,
		capabilities: Capabilities,
		onProgress?: (event: Record<string, unknown>) => void,
	): Promise<Record<string, unknown>> {
		return runProjectConfigure(
			this.configureRouteDeps(),
			projectId,
			capabilities,
			onProgress,
		);
	}

	private _refreshProjectCapabilities(
		projectId: string,
		capabilities: Capabilities,
	): Promise<Record<string, unknown>> {
		return applyProjectCapabilitiesOnly(
			this.configureRouteDeps(),
			projectId,
			capabilities,
		);
	}

	private uiOrigin(): string {
		return `http://${this.settings.server.host}:${this.settings.server.port}`;
	}

	private reloadProjectCapabilitiesFromDisk(projectId: string): Promise<void> {
		return reloadProjectCapabilitiesFromDisk(
			this.projectRouteDeps(),
			projectId,
		);
	}

	private notifyProjectChanged(projectId: string): void {
		notifyProjectChanged(this.projectEventClients, projectId);
	}

	private writePidFile() {
		const pidFile = getPidFilePath();
		const content = `${process.pid}:${VERSION}`;
		writeFileSync(pidFile, content, "utf-8");
	}

	async stop() {
		this.logger.info("Stopping CAPA server...");

		this.capsWatcher?.stop();

		// Stop token refresh scheduler
		this.tokenRefreshScheduler.stop();

		// Close all MCP servers
		for (const [projectId, mcpServer] of this.mcpServers) {
			await mcpServer.close();
		}

		// Stop all subprocesses
		this.subprocessManager.stopAll();

		closeAllOAuthCallbackServers();

		// Close database
		this.sessionManager.dispose();
		this.db.close();

		this.logger.success("CAPA server stopped");
		process.exit(0);
	}
}

// Main
const server = new CapaServer();

// Safety net for stray async failures. The MCP SDK's HTTP/stdio transports keep
// background sockets open; when a remote server becomes unreachable (e.g. VPN
// dropped) those can reject after we've already returned a response, which Bun
// would otherwise print as a raw "The socket connection was closed unexpectedly"
// error. Log these instead of letting them crash the process or leak to stderr.
process.on("unhandledRejection", (reason) => {
	const message = reason instanceof Error ? reason.message : String(reason);
	logger.warn(`Unhandled promise rejection (ignored): ${message}`);
});
process.on("uncaughtException", (error) => {
	logger.error(`Uncaught exception (ignored): ${error?.message ?? error}`);
});

// Handle shutdown signals
process.on("SIGTERM", () => server.stop());
process.on("SIGINT", () => server.stop());

// Start server
server.start().catch((error) => {
	logger.error("Failed to start server:", error);
	process.exit(1);
});
