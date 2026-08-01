import { existsSync, writeFileSync } from "fs";
import { createServer, Server as HttpServer } from "http";
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
import { projectUiUrl } from "../shared/ui-urls";
import { isUnderWrapWorkspacesDir } from "../shared/workspaces/paths";
import type { Capabilities, MCPServer } from "../types/capabilities";
import type { OAuth2Config } from "../types/oauth";
import type { RegistryCapability } from "../types/registry";
import { VERSION } from "../version";
import { initAuth, isLoopbackHost, requireAuth } from "./auth-middleware";
import { handleCapabilitiesMutation } from "./capabilities-routes";
import { CapabilitiesFileWatcher } from "./capabilities-watcher";
import {
	type ConfigureRouteDeps,
	handleProjectConfigure,
	runProjectConfigure,
} from "./configure-routes";
import { isAllowedOrigin } from "./cors-origin";
import { GitIntegrationManager } from "./git-integration-manager";
import {
	type GitIntegrationsRouteDeps,
	handleDisconnectIntegration,
	handleGetIntegrations,
	handleGitHubEnterprisePAT,
	handleGitHubOAuthCallback,
	handleGitHubOAuthStart,
	handleGitLabOAuthCallback,
	handleGitLabOAuthStart,
	handleGitLabSelfManagedPAT,
	handleGitTokenRefresh,
} from "./git-integrations-routes";
import { CapaMCPServer } from "./mcp-handler";
import {
	handleGetServerTools,
	handleGetShellToolSchema,
	handleGetShellTools,
	handleGetSkillContent,
	type McpMetaRouteDeps,
} from "./mcp-meta-routes";
import { OAuth2Manager } from "./oauth-manager";
import {
	handleDeleteProject,
	handleGetProject,
	handleGetProjectActivity,
	handleGetProjectActivityStats,
	handleGetProjects,
	handleProjectEvents,
	handleProjectFsList,
	handleProjectFsUpload,
	notifyProjectChanged,
	notifyToolCall,
	type ProjectRouteDeps,
	reloadProjectCapabilitiesFromDisk,
} from "./project-routes";
import {
	createRegistryHandler,
	deleteRegistryHandler,
	listRegistriesHandler,
	patchRegistryHandler,
	previewRegistryHandler,
	refreshRegistryHandler,
} from "./registries-routes";
import { type EffectiveCapsCacheEntry } from "./resolve-effective-capabilities";
import { SessionManager } from "./session-manager";
import { SubprocessManager } from "./subprocess-manager";
import { ToolCallTracer } from "./tool-call-tracer";
import {
	handleForceTokenRefresh,
	handleTokenRefreshStatus,
	type TokenRefreshRouteDeps,
} from "./token-refresh-routes";
import { TokenRefreshScheduler } from "./token-refresh-scheduler";
import {
	handleDeleteVariable,
	handleGetVariables,
	handlePutVariable,
	handleSetVariables,
	type VariablesRouteDeps,
} from "./variables-routes";

function mcpHandlerHttpStatus(error: unknown): number {
	if (error instanceof SyntaxError) {
		return 400;
	}
	const status =
		(error as { status?: number; statusCode?: number })?.status ??
		(error as { status?: number; statusCode?: number })?.statusCode;
	if (typeof status === "number" && status >= 400 && status < 500) {
		return status;
	}
	return 500;
}

class CapaServer {
	private db!: CapaDatabase;
	private sessionManager!: SessionManager;
	private subprocessManager!: SubprocessManager;
	private oauth2Manager!: OAuth2Manager;
	private gitIntegrationManager!: GitIntegrationManager;
	private tokenRefreshScheduler!: TokenRefreshScheduler;
	private httpServer!: HttpServer;
	private settings: any;
	private mcpServers = new Map<string, CapaMCPServer>();
	/** Claude-style OAuth callback servers: port -> { server, idleTimer }; closed after completion or 5 min idle */
	private oauthCallbackServers = new Map<
		number,
		{ server: HttpServer; idleTimer: ReturnType<typeof setTimeout> }
	>();
	private registryManager!: RegistryManager;
	private capsWatcher!: CapabilitiesFileWatcher;
	private toolCallTracer!: ToolCallTracer;
	private projectEventClients = new Map<
		string,
		Set<(chunk: Uint8Array) => void>
	>();
	/** Cached plugin-expanded capabilities keyed by project id */
	private effectiveCapsCache = new Map<string, EffectiveCapsCacheEntry>();
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
		const originCheck = isAllowedOrigin(requestOrigin);
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
			const auth = requireAuth(request, this.settings.server.host);
			if (!auth.ok) {
				return this.authFailureResponse(request, auth.reason, auth.status);
			}
			return this.handleAPI(request, server);
		}

		// Sub-agent MCP endpoints: /{projectId}/agents/{agentId}/mcp
		const agentMcpMatch = path.match(/^\/([^/]+)\/agents\/([^/]+)\/mcp$/);
		if (agentMcpMatch) {
			const projectId = agentMcpMatch[1];
			const agentId = agentMcpMatch[2];
			this.logger.debug(
				`MCP endpoint for project: ${projectId}, sub-agent: ${agentId}`,
			);
			const auth = requireAuth(request, this.settings.server.host);
			if (!auth.ok) {
				return this.authFailureResponse(request, auth.reason, auth.status);
			}
			return this.handleMCP(request, projectId, agentId);
		}

		// Main MCP endpoints: /{projectId}/mcp
		const mcpMatch = path.match(/^\/([^/]+)\/mcp$/);
		if (mcpMatch) {
			const projectId = mcpMatch[1];
			this.logger.debug(`MCP endpoint for project: ${projectId}`);
			const auth = requireAuth(request, this.settings.server.host);
			if (!auth.ok) {
				return this.authFailureResponse(request, auth.reason, auth.status);
			}
			return this.handleMCP(request, projectId);
		}

		this.logger.debug("404 Not Found");
		return new Response("Not Found", { status: 404 });
	}

	private async handleSpa(): Promise<Response> {
		return new Response(spaHtml as unknown as string, {
			headers: { "Content-Type": "text/html" },
		});
	}

	private async handleAPI(
		request: Request,
		bunServer?: { timeout?: (req: Request, seconds: number) => void },
	): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Get all projects
		if (path === "/api/projects" && request.method === "GET") {
			return this.handleGetProjects();
		}

		// Get project details
		const projectGetMatch = path.match(/^\/api\/projects\/([^/]+)$/);
		if (projectGetMatch && request.method === "GET") {
			const projectId = projectGetMatch[1];
			return this.handleGetProject(projectId);
		}

		// Delete / clean project (keeps capabilities file)
		if (projectGetMatch && request.method === "DELETE") {
			const projectId = projectGetMatch[1];
			return this.handleDeleteProject(projectId);
		}

		// Live capabilities file change stream (SSE)
		const projectEventsMatch = path.match(/^\/api\/projects\/([^/]+)\/events$/);
		if (projectEventsMatch && request.method === "GET") {
			// Bun closes quiet streams after ~10s unless idle timeout is disabled.
			bunServer?.timeout?.(request, 0);
			return this.handleProjectEvents(projectEventsMatch[1]);
		}

		// Recent tool-call activity for the project page feed
		const activityMatch = path.match(/^\/api\/projects\/([^/]+)\/activity$/);
		if (activityMatch && request.method === "GET") {
			return handleGetProjectActivity(
				this.projectRouteDeps(),
				activityMatch[1],
				url.searchParams.get("limit"),
				url.searchParams.get("before"),
				url.searchParams.get("beforeId"),
			);
		}

		const activityStatsMatch = path.match(
			/^\/api\/projects\/([^/]+)\/activity\/stats$/,
		);
		if (activityStatsMatch && request.method === "GET") {
			return handleGetProjectActivityStats(
				this.projectRouteDeps(),
				activityStatsMatch[1],
			);
		}

		// Configure project
		const configMatch = path.match(/^\/api\/projects\/([^/]+)\/configure$/);
		if (configMatch && request.method === "POST") {
			const projectId = configMatch[1];
			return this.handleProjectConfigure(projectId, request);
		}

		// Get required variables
		const varsGetMatch = path.match(/^\/api\/projects\/([^/]+)\/variables$/);
		if (varsGetMatch && request.method === "GET") {
			const projectId = varsGetMatch[1];
			return this.handleGetVariables(projectId);
		}

		// Set variables (bulk)
		if (varsGetMatch && request.method === "POST") {
			const projectId = varsGetMatch[1];
			return this.handleSetVariables(projectId, request);
		}

		// Put / delete a single variable in the catalog
		const varItemMatch = path.match(
			/^\/api\/projects\/([^/]+)\/variables\/([^/]+)$/,
		);
		if (varItemMatch && request.method === "PUT") {
			return this.handlePutVariable(
				varItemMatch[1],
				decodeURIComponent(varItemMatch[2]),
				request,
			);
		}
		if (varItemMatch && request.method === "DELETE") {
			return this.handleDeleteVariable(
				varItemMatch[1],
				decodeURIComponent(varItemMatch[2]),
			);
		}

		// Capabilities file mutations (write YAML + configure)
		const capsProjectMatch = path.match(
			/^\/api\/projects\/([^/]+)\/capabilities(?:\/|$)/,
		);
		if (capsProjectMatch) {
			const projectId = capsProjectMatch[1];
			const mutation = await handleCapabilitiesMutation(
				{
					db: this.db,
					registryManager: this.registryManager,
					configure: (id, caps) => this._runProjectConfigure(id, caps),
					markSelfWrite: (id) => this.capsWatcher.markSelfWrite(id),
					notifyChanged: (id) => this.notifyProjectChanged(id),
				},
				projectId,
				path,
				request.method,
				request,
			);
			if (mutation) return mutation;
		}

		// Project filesystem browse (for local path pickers)
		const fsListMatch = path.match(/^\/api\/projects\/([^/]+)\/fs$/);
		if (fsListMatch && request.method === "GET") {
			return this.handleProjectFsList(fsListMatch[1], request);
		}
		if (fsListMatch && request.method === "POST") {
			return this.handleProjectFsUpload(fsListMatch[1], request);
		}

		// Get OAuth2 servers
		const oauth2ServersMatch = path.match(
			/^\/api\/projects\/([^/]+)\/oauth-servers$/,
		);
		if (oauth2ServersMatch && request.method === "GET") {
			const projectId = oauth2ServersMatch[1];
			return this.handleGetOAuth2Servers(projectId);
		}

		// Start OAuth2 flow
		const oauth2StartMatch = path.match(
			/^\/api\/projects\/([^/]+)\/oauth\/start$/,
		);
		if (oauth2StartMatch && request.method === "POST") {
			const projectId = oauth2StartMatch[1];
			return this.handleOAuth2Start(projectId, request);
		}

		// OAuth2 callback
		const oauth2CallbackMatch = path.match(
			/^\/api\/projects\/([^/]+)\/oauth\/callback$/,
		);
		if (oauth2CallbackMatch && request.method === "GET") {
			const projectId = oauth2CallbackMatch[1];
			return this.handleOAuth2Callback(projectId, request);
		}

		// List tools for a specific server
		const serverToolsMatch = path.match(
			/^\/api\/projects\/([^/]+)\/servers\/([^/]+)\/tools$/,
		);
		if (serverToolsMatch && request.method === "GET") {
			const projectId = serverToolsMatch[1];
			const serverId = serverToolsMatch[2];
			return this.handleGetServerTools(projectId, serverId);
		}

		// Skill SKILL.md content for the project-detail UI
		const skillContentMatch = path.match(
			/^\/api\/projects\/([^/]+)\/skills\/([^/]+)\/content$/,
		);
		if (skillContentMatch && request.method === "GET") {
			const projectId = skillContentMatch[1];
			const skillId = decodeURIComponent(skillContentMatch[2]);
			return this.handleGetSkillContent(projectId, skillId);
		}

		// Shell tools endpoint — tool metadata for the capa shell, regardless of exposure mode
		const shellToolsMatch = path.match(
			/^\/api\/projects\/([^/]+)\/shell-tools$/,
		);
		if (shellToolsMatch && request.method === "GET") {
			const projectId = shellToolsMatch[1];
			return this.handleGetShellTools(projectId);
		}

		// On-demand schema for a single shell tool (?tool=<qualified-id>)
		const shellToolSchemaMatch = path.match(
			/^\/api\/projects\/([^/]+)\/shell-tool-schema$/,
		);
		if (shellToolSchemaMatch && request.method === "GET") {
			const projectId = shellToolSchemaMatch[1];
			const toolId = url.searchParams.get("tool") || "";
			return this.handleGetShellToolSchema(projectId, toolId);
		}

		// Disconnect OAuth2
		const oauth2DisconnectMatch = path.match(
			/^\/api\/projects\/([^/]+)\/oauth\/([^/]+)$/,
		);
		if (oauth2DisconnectMatch && request.method === "DELETE") {
			const projectId = oauth2DisconnectMatch[1];
			const serverId = oauth2DisconnectMatch[2];
			return this.handleOAuth2Disconnect(projectId, serverId);
		}

		// Token refresh scheduler status
		if (path === "/api/token-refresh/status" && request.method === "GET") {
			return this.handleTokenRefreshStatus();
		}

		// Force token refresh check
		if (path === "/api/token-refresh/check" && request.method === "POST") {
			return this.handleForceTokenRefresh();
		}

		// Git integrations endpoints
		if (path === "/api/integrations" && request.method === "GET") {
			return this.handleGetIntegrations();
		}

		// GitHub OAuth flow
		const githubOAuthStartMatch = path.match(
			/^\/api\/integrations\/github\/oauth\/start$/,
		);
		if (githubOAuthStartMatch && request.method === "POST") {
			return this.handleGitHubOAuthStart(request);
		}

		const githubOAuthCallbackMatch = path.match(
			/^\/api\/integrations\/github\/oauth\/callback$/,
		);
		if (
			githubOAuthCallbackMatch &&
			(request.method === "POST" || request.method === "GET")
		) {
			return this.handleGitHubOAuthCallback(request);
		}

		// GitLab OAuth flow
		const gitlabOAuthStartMatch = path.match(
			/^\/api\/integrations\/gitlab\/oauth\/start$/,
		);
		if (gitlabOAuthStartMatch && request.method === "POST") {
			return this.handleGitLabOAuthStart(request);
		}

		const gitlabOAuthCallbackMatch = path.match(
			/^\/api\/integrations\/gitlab\/oauth\/callback$/,
		);
		if (
			gitlabOAuthCallbackMatch &&
			(request.method === "POST" || request.method === "GET")
		) {
			return this.handleGitLabOAuthCallback(request);
		}

		// Git integration token refresh
		const gitTokenRefreshMatch = path.match(
			/^\/api\/integrations\/(github|gitlab)\/refresh$/,
		);
		if (gitTokenRefreshMatch) {
			if (request.method === "GET") {
				return new Response(
					JSON.stringify({ error: "Method not allowed. Use POST." }),
					{ status: 405, headers: { "Content-Type": "application/json" } },
				);
			}
			if (request.method === "POST") {
				const platform = gitTokenRefreshMatch[1] as "github" | "gitlab";
				return this.handleGitTokenRefresh(platform);
			}
		}

		// GitHub Enterprise PAT
		if (
			path === "/api/integrations/github-enterprise" &&
			request.method === "POST"
		) {
			return this.handleGitHubEnterprisePAT(request);
		}

		// GitLab Self-Managed PAT
		if (
			path === "/api/integrations/gitlab-self-managed" &&
			request.method === "POST"
		) {
			return this.handleGitLabSelfManagedPAT(request);
		}

		// Disconnect integration
		const disconnectMatch = path.match(
			/^\/api\/integrations\/([^/]+)(?:\/([^/]+))?$/,
		);
		if (disconnectMatch && request.method === "DELETE") {
			const platform = disconnectMatch[1];
			const host = disconnectMatch[2];
			return this.handleDisconnectIntegration(platform, host);
		}

		// --- Registry endpoints ---

		if (path === "/api/registries" && request.method === "GET") {
			return this.handleGetRegistries();
		}

		if (path === "/api/registries" && request.method === "POST") {
			return this.handleCreateRegistry(request);
		}

		if (path === "/api/registries/preview" && request.method === "GET") {
			return this.handlePreviewRegistry(url);
		}

		const registrySearchMatch = path.match(
			/^\/api\/registries\/([^/]+)\/search$/,
		);
		if (registrySearchMatch && request.method === "GET") {
			const registryId = decodeURIComponent(registrySearchMatch[1]);
			return this.handleRegistrySearch(registryId, url);
		}

		// view uses a wildcard tail so item IDs containing slashes work (e.g. "owner/repo/slug")
		const registryViewMatch = path.match(
			/^\/api\/registries\/([^/]+)\/view\/(.+)$/,
		);
		if (registryViewMatch && request.method === "GET") {
			const registryId = decodeURIComponent(registryViewMatch[1]);
			const itemId = decodeURIComponent(registryViewMatch[2]);
			return this.handleRegistryView(registryId, itemId, url);
		}

		const registryRefreshMatch = path.match(
			/^\/api\/registries\/([^/]+)\/refresh$/,
		);
		if (registryRefreshMatch && request.method === "POST") {
			const slug = decodeURIComponent(registryRefreshMatch[1]);
			return this.handleRefreshRegistry(slug);
		}

		const registryItemMatch = path.match(/^\/api\/registries\/([^/]+)$/);
		if (registryItemMatch && request.method === "DELETE") {
			const slug = decodeURIComponent(registryItemMatch[1]);
			return this.handleDeleteRegistry(slug);
		}
		if (registryItemMatch && request.method === "PATCH") {
			const slug = decodeURIComponent(registryItemMatch[1]);
			return this.handlePatchRegistry(slug, request);
		}

		return new Response("Not Found", { status: 404 });
	}

	private handleGetProjects(): Promise<Response> {
		return handleGetProjects(this.projectRouteDeps());
	}

	private handleDeleteProject(projectId: string): Promise<Response> {
		return handleDeleteProject(this.projectRouteDeps(), projectId);
	}

	private handleGetProject(projectId: string): Promise<Response> {
		return handleGetProject(this.projectRouteDeps(), projectId);
	}

	private handleProjectFsList(
		projectId: string,
		request: Request,
	): Promise<Response> {
		return handleProjectFsList(this.projectRouteDeps(), projectId, request);
	}

	private handleProjectFsUpload(
		projectId: string,
		request: Request,
	): Promise<Response> {
		return handleProjectFsUpload(this.projectRouteDeps(), projectId, request);
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
		);
		this.mcpServers.set(cacheKey, mcpServer);
		return mcpServer;
	}

	private handleGetServerTools(
		projectId: string,
		serverId: string,
	): Promise<Response> {
		return handleGetServerTools(this.mcpMetaRouteDeps(), projectId, serverId);
	}

	private handleGetSkillContent(
		projectId: string,
		skillId: string,
	): Promise<Response> {
		return handleGetSkillContent(this.mcpMetaRouteDeps(), projectId, skillId);
	}

	private handleGetShellTools(projectId: string): Promise<Response> {
		return handleGetShellTools(this.mcpMetaRouteDeps(), projectId);
	}

	private handleGetShellToolSchema(
		projectId: string,
		toolId: string,
	): Promise<Response> {
		return handleGetShellToolSchema(this.mcpMetaRouteDeps(), projectId, toolId);
	}

	private handleProjectConfigure(
		projectId: string,
		request: Request,
	): Promise<Response> {
		return handleProjectConfigure(
			this.configureRouteDeps(),
			projectId,
			request,
		);
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

	private handleGetVariables(projectId: string): Promise<Response> {
		return handleGetVariables(this.variablesRouteDeps(), projectId);
	}

	private handlePutVariable(
		projectId: string,
		name: string,
		request: Request,
	): Promise<Response> {
		return handlePutVariable(
			this.variablesRouteDeps(),
			projectId,
			name,
			request,
		);
	}

	private handleDeleteVariable(
		projectId: string,
		name: string,
	): Promise<Response> {
		return handleDeleteVariable(this.variablesRouteDeps(), projectId, name);
	}

	private handleSetVariables(
		projectId: string,
		request: Request,
	): Promise<Response> {
		return handleSetVariables(this.variablesRouteDeps(), projectId, request);
	}

	private async handleGetOAuth2Servers(projectId: string): Promise<Response> {
		const apiLogger = this.logger.child("API");
		apiLogger.info(`Get OAuth2 servers for project: ${projectId}`);
		try {
			const capabilities =
				this.sessionManager.getProjectCapabilities(projectId);
			if (!capabilities) {
				return new Response(
					JSON.stringify({ error: "Project not configured" }),
					{ status: 404, headers: { "Content-Type": "application/json" } },
				);
			}

			// Ensure URL-based servers that require OAuth have def.oauth2 set (on-demand detection)
			let capabilitiesUpdated = false;
			for (const server of capabilities.servers) {
				const hasExplicitAuthOnDemand =
					server.def.headers &&
					Object.keys(server.def.headers).some(
						(k) => k.toLowerCase() === "authorization",
					);
				if (server.def.url && !server.def.oauth2 && !hasExplicitAuthOnDemand) {
					try {
						const oauth2Config =
							await this.oauth2Manager.detectOAuth2Requirement(server.def.url, {
								tlsSkipVerify: server.def.tlsSkipVerify,
							});
						if (oauth2Config) {
							apiLogger.debug(`OAuth2 detected for ${server.id} (on-demand)`);
							server.def.oauth2 = oauth2Config;
							capabilitiesUpdated = true;
						}
					} catch (detectionError: any) {
						apiLogger.warn(
							`OAuth2 detection failed for ${server.id}: ${detectionError?.message ?? detectionError}`,
						);
					}
				}
			}
			if (capabilitiesUpdated) {
				this.sessionManager.setProjectCapabilities(projectId, capabilities);
			}

			const oauth2Servers = capabilities.servers
				.filter((s: any) => s.def.oauth2)
				.map((s: MCPServer) => {
					const isConnected = this.oauth2Manager.isServerConnected(
						projectId,
						s.id,
					);
					let expiresAt: number | undefined;

					if (isConnected) {
						const tokenData = this.db.getOAuthToken(projectId, s.id);
						expiresAt = tokenData?.expires_at ?? undefined;
					}

					return {
						serverId: s.id,
						serverUrl: s.def.url,
						displayName: s.displayName ?? s.id,
						isConnected: isConnected,
						expiresAt: expiresAt,
						oauth2Config: s.def.oauth2,
					};
				});

			return new Response(JSON.stringify({ servers: oauth2Servers }), {
				headers: { "Content-Type": "application/json" },
			});
		} catch (error: any) {
			// Log full detail server-side, but return a generic message so raw
			// exception text (stack-trace exposure) never reaches the client.
			apiLogger.failure(
				`Error getting OAuth2 servers: ${error?.message ?? error}`,
			);
			return new Response(
				JSON.stringify({ error: "Failed to load OAuth2 servers" }),
				{ status: 500, headers: { "Content-Type": "application/json" } },
			);
		}
	}

	private uiOrigin(): string {
		return `http://${this.settings.server.host}:${this.settings.server.port}`;
	}

	/** Close and remove the callback server for a port (after completion or idle timeout). */
	private closeOAuthCallbackServer(port: number): void {
		const entry = this.oauthCallbackServers.get(port);
		if (!entry) return;
		clearTimeout(entry.idleTimer);
		entry.server.close();
		this.oauthCallbackServers.delete(port);
		this.logger.debug(`OAuth callback server on port ${port} closed`);
	}

	/**
	 * Ensure a Claude-style OAuth callback server is listening on the given port.
	 * Serves GET /callback?code=...&state=... and redirects to main UI after token exchange.
	 * Closed after completion or after 5 minutes idle. Used when a plugin provides client_id + callbackPort in .mcp.json (e.g. Slack).
	 * Binds directly and retries on EADDRINUSE (no separate port-availability check).
	 */
	private async ensureOAuthCallbackServer(
		startPort: number,
		maxAttempts = 10,
	): Promise<number> {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const port = startPort + attempt;
			if (this.oauthCallbackServers.has(port)) {
				return port;
			}
			try {
				await this.bindOAuthCallbackServer(port);
				return port;
			} catch (err: any) {
				if (err?.code === "EADDRINUSE") {
					this.logger.warn(
						`OAuth callback port ${port} in use, trying ${port + 1}`,
					);
					continue;
				}
				throw err;
			}
		}
		throw new Error(
			`Could not bind OAuth callback server after ${maxAttempts} attempts starting at ${startPort}`,
		);
	}

	private bindOAuthCallbackServer(port: number): Promise<void> {
		const self = this;
		const IDLE_MS = 5 * 60 * 1000; // 5 minutes
		const mainBase = this.uiOrigin();

		return new Promise((resolve, reject) => {
			const server = createServer((req, res) => {
				if (req.method !== "GET" || !req.url) {
					res.writeHead(405);
					res.end();
					return;
				}
				const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
				if (reqUrl.pathname !== "/callback") {
					res.writeHead(404);
					res.end();
					return;
				}
				const entry = self.oauthCallbackServers.get(port);
				if (entry) clearTimeout(entry.idleTimer);
				const closeWhenDone = () => {
					res.on("finish", () => self.closeOAuthCallbackServer(port));
				};

				const code = reqUrl.searchParams.get("code");
				const state = reqUrl.searchParams.get("state");
				const error = reqUrl.searchParams.get("error");
				const apiLogger = self.logger.child("API");

				const redirectToUi = (
					projectId: string | undefined,
					success: boolean,
					message?: string,
					serverId?: string,
				) => {
					closeWhenDone();
					const loc = projectId
						? projectUiUrl(mainBase, projectId, {
								...(success
									? { oauth_success: message ?? "true" }
									: { oauth_error: message ?? "Unknown error" }),
								...(serverId ? { server: serverId } : {}),
							})
						: `${mainBase}/`;
					res.writeHead(302, { Location: loc });
					res.end();
				};

				if (error) {
					apiLogger.error(`OAuth2 callback error: ${error}`);
					let projectId: string | undefined;
					if (state) {
						const flow = self.db.getFlowState(state);
						projectId = flow?.project_id;
					}
					redirectToUi(projectId, false, error);
					return;
				}

				if (!code || !state) {
					redirectToUi(undefined, false, "Missing code or state");
					return;
				}

				apiLogger.info("OAuth2 callback (Claude-style) received");
				self.oauth2Manager
					.handleCallback(code, state)
					.then((result) => {
						if (!result.success) {
							apiLogger.failure(`Callback failed: ${result.error}`);
							redirectToUi(
								result.projectId,
								false,
								result.error ?? "Token exchange failed",
							);
							return;
						}
						apiLogger.success(
							`OAuth2 flow completed for server: ${result.serverId}`,
						);
						redirectToUi(result.projectId, true, "true", result.serverId);
					})
					.catch((err: any) => {
						apiLogger.failure(`Callback error: ${err.message}`);
						redirectToUi(
							undefined,
							false,
							err.message ?? "Token exchange failed",
						);
					});
			});

			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				self.logger.info(
					`OAuth callback server (Claude-style) listening on http://localhost:${port}/callback`,
				);
				const idleTimer = setTimeout(() => {
					self.logger.debug(
						`OAuth callback server on port ${port} idle for 5 min, closing`,
					);
					self.closeOAuthCallbackServer(port);
				}, IDLE_MS);
				self.oauthCallbackServers.set(port, { server, idleTimer });
				server.on("error", (err: any) => {
					self.logger.failure(
						`OAuth callback server on port ${port}: ${err.message}`,
					);
					self.closeOAuthCallbackServer(port);
				});
				resolve();
			});
		});
	}

	private async handleOAuth2Start(
		projectId: string,
		request: Request,
	): Promise<Response> {
		const apiLogger = this.logger.child("API");
		try {
			const url = new URL(request.url);
			const serverId = url.searchParams.get("server");

			if (!serverId) {
				return new Response(
					JSON.stringify({ error: "Missing server parameter" }),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}

			apiLogger.info(`Start OAuth2 flow for server: ${serverId}`);

			const capabilities =
				this.sessionManager.getProjectCapabilities(projectId);
			if (!capabilities) {
				return new Response(
					JSON.stringify({ error: "Project not configured" }),
					{ status: 404, headers: { "Content-Type": "application/json" } },
				);
			}

			const server = capabilities.servers.find((s: any) => s.id === serverId);
			if (!server || !server.def.oauth2) {
				return new Response(
					JSON.stringify({
						error: "Server not found or does not require OAuth2",
					}),
					{ status: 404, headers: { "Content-Type": "application/json" } },
				);
			}

			const oauth2 = server.def.oauth2 as {
				client_id?: string;
				clientId?: string;
				CLIENT_ID?: string;
				callback_port?: number | string;
				callbackPort?: number | string;
				CALLBACK_PORT?: number | string;
				registrationEndpoint?: string;
				[k: string]: any;
			};
			// Read embedded values with the same fallbacks the configure-handler accepts —
			// older capabilities stored in the DB (pre-normalization) may still use camelCase
			// or uppercase snake_case keys. Without this we silently fall back to the capa
			// server callback URL, which auth servers reject as an unregistered redirect.
			const effectiveClientId =
				oauth2.client_id ??
				oauth2.clientId ??
				oauth2.CLIENT_ID ??
				(oauth2 as any).oauth?.clientId ??
				(oauth2 as any).oauth?.client_id;
			const callbackPortRaw =
				oauth2.callback_port ?? oauth2.callbackPort ?? oauth2.CALLBACK_PORT;
			let effectiveCallbackPort: number | undefined;
			if (typeof callbackPortRaw === "number" && callbackPortRaw > 0) {
				effectiveCallbackPort = callbackPortRaw;
			} else if (typeof callbackPortRaw === "string") {
				const parsed = Number(callbackPortRaw);
				if (Number.isFinite(parsed) && parsed > 0)
					effectiveCallbackPort = parsed;
			}
			// Claude-style only when dynamic client registration is not supported and .mcp.json
			// provides client_id + callbackPort (e.g. Slack). Auth servers register specific
			// (client_id, redirect_uri) pairs; falling back to the capa-server URL when the
			// plugin embedded a callbackPort causes the auth server to reject the request.
			const useClaudeCallback =
				!!effectiveClientId &&
				effectiveCallbackPort != null &&
				!oauth2.registrationEndpoint;
			let callbackPort = effectiveCallbackPort;
			if (useClaudeCallback && callbackPort != null) {
				callbackPort = await this.ensureOAuthCallbackServer(callbackPort);
			}
			const redirectUri = useClaudeCallback
				? `http://localhost:${callbackPort}/callback`
				: `http://${this.settings.server.host}:${this.settings.server.port}/api/projects/${projectId}/oauth/callback`;
			apiLogger.debug(
				`OAuth2 redirect for ${serverId}: ${redirectUri} (useClaudeCallback=${useClaudeCallback}, client_id=${effectiveClientId ? "set" : "missing"}, callback_port=${effectiveCallbackPort ?? "missing"}, registrationEndpoint=${oauth2.registrationEndpoint ? "set" : "missing"})`,
			);

			// Ensure the OAuth2Config we hand to the manager has the canonical snake_case
			// client_id populated so generateAuthorizationUrl emits the embedded app id.
			// Plugin manifests (e.g. Slack) often only embed client_id + callback_port;
			// discovery fills authorization/token endpoints during configure — but GET
			// can re-expand plugins and drop those. Discover on demand if still missing.
			let configForFlow: OAuth2Config = {
				...(server.def.oauth2 as OAuth2Config),
				...(effectiveClientId ? { client_id: effectiveClientId } : {}),
			};
			const hasAuthEndpoint = !!(
				configForFlow.authorizationEndpoint ||
				(configForFlow as { authorizationUrl?: string }).authorizationUrl
			);
			const hasTokenEndpoint = !!(
				configForFlow.tokenEndpoint ||
				(configForFlow as { tokenUrl?: string }).tokenUrl
			);
			if ((!hasAuthEndpoint || !hasTokenEndpoint) && server.def.url) {
				apiLogger.info(`Discovering OAuth endpoints for ${serverId}…`);
				const detected = await this.oauth2Manager.detectOAuth2Requirement(
					server.def.url,
					{
						tlsSkipVerify: server.def.tlsSkipVerify,
					},
				);
				if (!detected) {
					return new Response(
						JSON.stringify({
							error:
								"Could not discover OAuth authorization endpoints for this server. Check that the MCP URL is reachable.",
						}),
						{ status: 502, headers: { "Content-Type": "application/json" } },
					);
				}
				configForFlow = {
					...detected,
					...configForFlow,
					authorizationEndpoint:
						configForFlow.authorizationEndpoint ||
						(configForFlow as { authorizationUrl?: string }).authorizationUrl ||
						detected.authorizationEndpoint,
					tokenEndpoint:
						configForFlow.tokenEndpoint ||
						(configForFlow as { tokenUrl?: string }).tokenUrl ||
						detected.tokenEndpoint,
					resourceServer:
						configForFlow.resourceServer ||
						detected.resourceServer ||
						server.def.url,
					...(effectiveClientId ? { client_id: effectiveClientId } : {}),
				};
				server.def.oauth2 = configForFlow;
				this.sessionManager.setProjectCapabilities(projectId, capabilities);
			}

			const { url: authUrl, state } =
				await this.oauth2Manager.generateAuthorizationUrl(
					projectId,
					serverId,
					configForFlow,
					redirectUri,
				);

			apiLogger.success("Authorization URL generated");
			return new Response(
				JSON.stringify({ authorizationUrl: authUrl, state }),
				{ headers: { "Content-Type": "application/json" } },
			);
		} catch (error: any) {
			apiLogger.failure(`Error: ${error.message}`);
			return new Response(JSON.stringify({ error: error.message }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

	private async handleOAuth2Callback(
		projectId: string,
		request: Request,
	): Promise<Response> {
		const apiLogger = this.logger.child("API");
		try {
			const url = new URL(request.url);
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			const error = url.searchParams.get("error");

			if (error) {
				apiLogger.error(`OAuth2 callback error: ${error}`);
				const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, {
					oauth_error: error,
				});
				return new Response(null, {
					status: 302,
					headers: { Location: redirectUrl },
				});
			}

			if (!code || !state) {
				return new Response(
					JSON.stringify({ error: "Missing code or state parameter" }),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}

			apiLogger.info(`OAuth2 callback for project: ${projectId}`);

			const result = await this.oauth2Manager.handleCallback(code, state);

			if (!result.success) {
				apiLogger.failure(`Callback failed: ${result.error}`);
				const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, {
					oauth_error: result.error || "Unknown error",
				});
				return new Response(null, {
					status: 302,
					headers: { Location: redirectUrl },
				});
			}

			apiLogger.success(`OAuth2 flow completed for server: ${result.serverId}`);

			const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, {
				oauth_success: "true",
				...(result.serverId ? { server: result.serverId } : {}),
			});
			return new Response(null, {
				status: 302,
				headers: { Location: redirectUrl },
			});
		} catch (error: any) {
			const apiLogger = this.logger.child("API");
			apiLogger.failure(`Error: ${error.message}`);
			const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, {
				oauth_error: error.message,
			});
			return new Response(null, {
				status: 302,
				headers: { Location: redirectUrl },
			});
		}
	}

	private async handleOAuth2Disconnect(
		projectId: string,
		serverId: string,
	): Promise<Response> {
		const apiLogger = this.logger.child("API");
		apiLogger.info(`Disconnect OAuth2 for server: ${serverId}`);
		try {
			this.oauth2Manager.disconnect(projectId, serverId);
			return new Response(JSON.stringify({ success: true }), {
				headers: { "Content-Type": "application/json" },
			});
		} catch (error: any) {
			apiLogger.failure(`Error: ${error.message}`);
			return new Response(JSON.stringify({ error: error.message }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

	private handleTokenRefreshStatus(): Promise<Response> {
		return handleTokenRefreshStatus(this.tokenRefreshRouteDeps());
	}

	private handleForceTokenRefresh(): Promise<Response> {
		return handleForceTokenRefresh(this.tokenRefreshRouteDeps());
	}

	// Git Integration handlers (delegated to git-integrations-routes.ts)

	private handleGetIntegrations(): Promise<Response> {
		return handleGetIntegrations(this.gitIntegrationsRouteDeps());
	}

	private handleGitHubOAuthStart(request: Request): Promise<Response> {
		return handleGitHubOAuthStart(this.gitIntegrationsRouteDeps(), request);
	}

	private handleGitHubOAuthCallback(request: Request): Promise<Response> {
		return handleGitHubOAuthCallback(this.gitIntegrationsRouteDeps(), request);
	}

	private handleGitLabOAuthStart(request: Request): Promise<Response> {
		return handleGitLabOAuthStart(this.gitIntegrationsRouteDeps(), request);
	}

	private handleGitLabOAuthCallback(request: Request): Promise<Response> {
		return handleGitLabOAuthCallback(this.gitIntegrationsRouteDeps(), request);
	}

	private handleGitTokenRefresh(
		platform: "github" | "gitlab",
	): Promise<Response> {
		return handleGitTokenRefresh(this.gitIntegrationsRouteDeps(), platform);
	}

	private handleGitHubEnterprisePAT(request: Request): Promise<Response> {
		return handleGitHubEnterprisePAT(this.gitIntegrationsRouteDeps(), request);
	}

	private handleGitLabSelfManagedPAT(request: Request): Promise<Response> {
		return handleGitLabSelfManagedPAT(this.gitIntegrationsRouteDeps(), request);
	}

	private handleDisconnectIntegration(
		platform: string,
		host?: string,
	): Promise<Response> {
		return handleDisconnectIntegration(
			this.gitIntegrationsRouteDeps(),
			platform,
			host,
		);
	}

	// --- Registry handlers ---

	private async handleGetRegistries(): Promise<Response> {
		this.logger.child("API").info("List registries");
		return listRegistriesHandler(this.db, this.registryManager);
	}

	private async handleCreateRegistry(request: Request): Promise<Response> {
		this.logger.child("API").info("Install registry");
		return createRegistryHandler(this.db, this.registryManager, request);
	}

	private async handleDeleteRegistry(slug: string): Promise<Response> {
		this.logger.child("API").info(`Delete registry: ${slug}`);
		return deleteRegistryHandler(this.db, this.registryManager, slug);
	}

	private async handlePatchRegistry(
		slug: string,
		request: Request,
	): Promise<Response> {
		this.logger.child("API").info(`Patch registry: ${slug}`);
		return patchRegistryHandler(this.db, this.registryManager, slug, request);
	}

	private async handleRefreshRegistry(slug: string): Promise<Response> {
		this.logger.child("API").info(`Refresh registry: ${slug}`);
		return refreshRegistryHandler(this.db, this.registryManager, slug);
	}

	private async handlePreviewRegistry(url: URL): Promise<Response> {
		this.logger.child("API").info("Preview registry");
		return previewRegistryHandler(this.db, url);
	}

	private async handleRegistrySearch(
		registryId: string,
		url: URL,
	): Promise<Response> {
		const apiLogger = this.logger.child("API");
		apiLogger.info(`Registry search: ${registryId}`);
		try {
			const capability = (url.searchParams.get("capability") ??
				"skills") as RegistryCapability;
			const query = url.searchParams.get("q") ?? undefined;
			const limit = url.searchParams.has("limit")
				? Number(url.searchParams.get("limit"))
				: undefined;
			const cursor = url.searchParams.get("cursor") ?? undefined;

			const result = await this.registryManager.search(registryId, {
				capability,
				query,
				limit,
				cursor,
			});
			return new Response(JSON.stringify(result), {
				headers: { "Content-Type": "application/json" },
			});
		} catch (error: any) {
			apiLogger.failure(`Registry search error: ${error.message}`);
			const status = error.message.includes("not found") ? 404 : 502;
			return new Response(
				JSON.stringify({ error: error.message, registry: registryId }),
				{ status, headers: { "Content-Type": "application/json" } },
			);
		}
	}

	private async handleRegistryView(
		registryId: string,
		itemId: string,
		url: URL,
	): Promise<Response> {
		const apiLogger = this.logger.child("API");
		apiLogger.info(`Registry view: ${registryId} / ${itemId}`);
		try {
			const capability = (url.searchParams.get("capability") ??
				"skills") as RegistryCapability;
			const detail = await this.registryManager.view(registryId, {
				capability,
				id: itemId,
			});
			return new Response(JSON.stringify(detail), {
				headers: { "Content-Type": "application/json" },
			});
		} catch (error: any) {
			apiLogger.failure(`Registry view error: ${error.message}`);
			const status = error.message.includes("not found") ? 404 : 502;
			return new Response(
				JSON.stringify({ error: error.message, registry: registryId }),
				{ status, headers: { "Content-Type": "application/json" } },
			);
		}
	}

	private async handleMCP(
		request: Request,
		projectId: string,
		agentId?: string,
	): Promise<Response> {
		const mcpLogger = this.logger.child("MCP");
		const cacheKey = agentId ? `${projectId}:${agentId}` : projectId;

		// Get or create MCP server for this project (or project+sub-agent)
		let mcpServer = this.mcpServers.get(cacheKey);

		if (!mcpServer) {
			const label = agentId
				? `project: ${projectId}, sub-agent: ${agentId}`
				: `project: ${projectId}`;
			mcpLogger.info(`Creating new MCP server for ${label}`);
			// Get project from database
			const project = this.db.getProject(projectId);
			if (!project) {
				mcpLogger.warn("Project not found");
				return new Response("Project not found", { status: 404 });
			}

			mcpServer = new CapaMCPServer(
				this.db,
				this.sessionManager,
				projectId,
				project.path,
				agentId,
				this.toolCallTracer,
			);

			this.mcpServers.set(cacheKey, mcpServer);
			mcpLogger.success("MCP server created");
		}

		const requestOrigin = request.headers.get("Origin");
		const originCheck = isAllowedOrigin(requestOrigin);
		const corsHeaders: Record<string, string> = {
			"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};
		if (originCheck.origin) {
			corsHeaders["Access-Control-Allow-Origin"] = originCheck.origin;
		}

		// Handle MCP protocol via HTTP (simplified without SSE)
		if (request.method === "POST") {
			if (requestOrigin && !originCheck.allowed) {
				return new Response(
					`Origin ${requestOrigin} not allowed. Set CAPA_ALLOWED_ORIGINS env var to include this origin.`,
					{ status: 403 },
				);
			}

			try {
				const message = await request.json();
				mcpLogger.debug(
					`${message.method || "notification"} (id: ${message.id || "none"})`,
				);

				// Handle JSON-RPC message
				const result = await mcpServer.handleMessage(message);

				// Return simple JSON response (not SSE)
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						...corsHeaders,
					},
				});
			} catch (error: any) {
				mcpLogger.failure(`Error: ${error.message}`);
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						error: {
							code: -32603,
							message: error.message || "Internal error",
						},
						id: null,
					}),
					{
						status: mcpHandlerHttpStatus(error),
						headers: {
							"Content-Type": "application/json",
							...corsHeaders,
						},
					},
				);
			}
		}

		// Handle OPTIONS for CORS
		if (request.method === "OPTIONS") {
			if (requestOrigin && !originCheck.allowed) {
				return new Response(
					`Origin ${requestOrigin} not allowed. Set CAPA_ALLOWED_ORIGINS env var to include this origin.`,
					{ status: 403 },
				);
			}

			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}

		return new Response("Method not allowed", { status: 405 });
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

	private handleProjectEvents(projectId: string): Response {
		return handleProjectEvents(this.projectRouteDeps(), projectId);
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

		// Close Claude-style OAuth callback servers
		for (const [port, entry] of this.oauthCallbackServers) {
			clearTimeout(entry.idleTimer);
			entry.server.close();
			this.logger.debug(`Closed OAuth callback server on port ${port}`);
		}
		this.oauthCallbackServers.clear();

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
