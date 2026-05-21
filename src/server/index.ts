import { writeFileSync, existsSync } from 'fs';
import { createServer, Server as HttpServer } from 'http';
import { loadSettings, getDatabasePath, getPidFilePath, ensureCapaDir } from '../shared/config';
import { CapaDatabase } from '../db/database';
import { SessionManager } from './session-manager';
import { SubprocessManager } from './subprocess-manager';
import { CapaMCPServer } from './mcp-handler';
import type { ShellToolInfo } from './mcp-handler';
import { OAuth2Manager } from './oauth-manager';
import { GitIntegrationManager } from './git-integration-manager';
import { TokenRefreshScheduler } from './token-refresh-scheduler';
import type { Capabilities, MCPServer, ToolMCPDefinition, ToolCommandDefinition } from '../types/capabilities';
import type { OAuth2Config } from '../types/oauth';
import { extractAllVariables } from '../shared/variable-resolver';
import { RegistryManager } from '../shared/registries/manager';
import type { RegistryCapability } from '../types/registry';
import { VERSION } from '../version';
import { logger } from '../shared/logger';
import { projectUiUrl } from '../shared/ui-urls';
import { initAuth, requireAuth, isLoopbackHost } from './auth-middleware';
import { oauthBridgeResponse } from './oauth-bridge';

// Import the React SPA bundle as text at compile time - this bundles it into the binary
import spaHtml from '../../web-ui/dist/index.html' with { type: 'text' };

function mcpHandlerHttpStatus(error: unknown): number {
  if (error instanceof SyntaxError) {
    return 400;
  }
  const status = (error as { status?: number; statusCode?: number })?.status
    ?? (error as { status?: number; statusCode?: number })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return status;
  }
  return 500;
}

function isAllowedOrigin(origin: string | null): { allowed: boolean; origin?: string } {
  if (!origin) {
    return { allowed: false };
  }

  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return { allowed: true, origin };
    }
  } catch {
    // fall through to env allow-list
  }

  const extras =
    process.env.CAPA_ALLOWED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  if (extras.includes(origin)) {
    return { allowed: true, origin };
  }

  return { allowed: false };
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
  private oauthCallbackServers = new Map<number, { server: HttpServer; idleTimer: ReturnType<typeof setTimeout> }>();
  private registryManager = new RegistryManager();
  private startTime: number = Date.now();
  private logger = logger.child('CapaServer');

  async start() {
    this.logger.info('Starting CAPA server...');

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
    this.sessionManager = new SessionManager(this.db);
    this.subprocessManager = new SubprocessManager(this.db);
    this.oauth2Manager = new OAuth2Manager(this.db);
    this.gitIntegrationManager = new GitIntegrationManager(this.db);
    
    // Connect OAuth2Manager with SessionManager for capabilities access
    this.oauth2Manager.setCapabilitiesProvider(() => this.sessionManager.getAllProjectCapabilities());

    // Initialize and start token refresh scheduler
    const checkInterval = (this.settings.token_refresh?.check_interval_seconds ?? 60) * 1000;
    const refreshThreshold = (this.settings.token_refresh?.refresh_threshold_seconds ?? 600) * 1000;
    
    this.tokenRefreshScheduler = new TokenRefreshScheduler(
      this.db,
      this.oauth2Manager,
      {
        checkInterval,
        refreshThreshold,
      }
    );
    this.tokenRefreshScheduler.setCapabilitiesProvider(() => this.sessionManager.getAllProjectCapabilities());
    this.tokenRefreshScheduler.setGitIntegrationManager(this.gitIntegrationManager);
    this.tokenRefreshScheduler.start();
    this.logger.success('Token refresh scheduler started');

    // Start HTTP server
    await this.startHttpServer();

    // Note: OAuth redirect server is started on-demand during OAuth flows

    // Write PID file
    this.writePidFile();

    this.logger.success(`CAPA server running at http://${this.settings.server.host}:${this.settings.server.port}`);
    this.logger.info(`OAuth redirect server will start on-demand at http://${this.settings.server.host}:${this.settings.oauth_redirect_port || 3100}`);
    this.logger.info(`Version: ${VERSION}`);
  }

  private async cleanupMissingProjects(): Promise<void> {
    const projects = this.db.getAllProjects();
    let removed = 0;
    for (const project of projects) {
      if (!existsSync(project.path)) {
        this.logger.warn(`Project directory not found, removing project "${project.id}" at path: ${project.path}`);
        this.db.deleteProject(project.id);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.info(`Removed ${removed} project(s) with missing directories`);
    } else {
      this.logger.debug('All configured projects have valid directories');
    }
  }

  private authFailureResponse(request: Request, reason: string, status: number): Response {
    const requestOrigin = request.headers.get('Origin');
    const originCheck = isAllowedOrigin(requestOrigin);
    const headers: Record<string, string> = {};
    if (originCheck.origin) {
      headers['Access-Control-Allow-Origin'] = originCheck.origin;
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
        'capa: clients must send `Authorization: Bearer <token>` to /api/* and the MCP route\n'
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


  private async handleRequest(request: Request, server: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    this.logger.http(request.method, path);

    // Health check
    if (path === '/health') {
      this.logger.debug('Health check');
      const uptime = (Date.now() - this.startTime) / 1000; // uptime in seconds
      return new Response(
        JSON.stringify({ 
          status: 'ok', 
          version: VERSION,
          uptime: uptime
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }


    // SPA routes: home page and all /ui/* paths
    if (path === '/' || path === '/ui' || path.startsWith('/ui/')) {
      this.logger.debug('SPA');
      return this.handleSpa();
    }

    // API endpoints
    if (path.startsWith('/api/')) {
      this.logger.debug('API endpoint');
      const auth = requireAuth(request, this.settings.server.host);
      if (!auth.ok) {
        return this.authFailureResponse(request, auth.reason, auth.status);
      }
      return this.handleAPI(request);
    }

    // Sub-agent MCP endpoints: /{projectId}/agents/{agentId}/mcp
    const agentMcpMatch = path.match(/^\/([^/]+)\/agents\/([^/]+)\/mcp$/);
    if (agentMcpMatch) {
      const projectId = agentMcpMatch[1];
      const agentId = agentMcpMatch[2];
      this.logger.debug(`MCP endpoint for project: ${projectId}, sub-agent: ${agentId}`);
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

    this.logger.debug('404 Not Found');
    return new Response('Not Found', { status: 404 });
  }

  private async handleSpa(): Promise<Response> {
    return new Response(spaHtml as unknown as string, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  private async handleAPI(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Get all projects
    if (path === '/api/projects' && request.method === 'GET') {
      return this.handleGetProjects();
    }

    // Get project details
    const projectGetMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectGetMatch && request.method === 'GET') {
      const projectId = projectGetMatch[1];
      return this.handleGetProject(projectId);
    }

    // Configure project
    const configMatch = path.match(/^\/api\/projects\/([^/]+)\/configure$/);
    if (configMatch && request.method === 'POST') {
      const projectId = configMatch[1];
      return this.handleProjectConfigure(projectId, request);
    }

    // Get required variables
    const varsGetMatch = path.match(/^\/api\/projects\/([^/]+)\/variables$/);
    if (varsGetMatch && request.method === 'GET') {
      const projectId = varsGetMatch[1];
      return this.handleGetVariables(projectId);
    }

    // Set variables
    if (varsGetMatch && request.method === 'POST') {
      const projectId = varsGetMatch[1];
      return this.handleSetVariables(projectId, request);
    }

    // Get OAuth2 servers
    const oauth2ServersMatch = path.match(/^\/api\/projects\/([^/]+)\/oauth-servers$/);
    if (oauth2ServersMatch && request.method === 'GET') {
      const projectId = oauth2ServersMatch[1];
      return this.handleGetOAuth2Servers(projectId);
    }

    // Start OAuth2 flow
    const oauth2StartMatch = path.match(/^\/api\/projects\/([^/]+)\/oauth\/start$/);
    if (oauth2StartMatch && request.method === 'POST') {
      const projectId = oauth2StartMatch[1];
      return this.handleOAuth2Start(projectId, request);
    }

    // OAuth2 callback
    const oauth2CallbackMatch = path.match(/^\/api\/projects\/([^/]+)\/oauth\/callback$/);
    if (oauth2CallbackMatch && request.method === 'GET') {
      const projectId = oauth2CallbackMatch[1];
      return this.handleOAuth2Callback(projectId, request);
    }

    // List tools for a specific server
    const serverToolsMatch = path.match(/^\/api\/projects\/([^/]+)\/servers\/([^/]+)\/tools$/);
    if (serverToolsMatch && request.method === 'GET') {
      const projectId = serverToolsMatch[1];
      const serverId = serverToolsMatch[2];
      return this.handleGetServerTools(projectId, serverId);
    }

    // Shell tools endpoint — all tools with schemas, regardless of exposure mode
    const shellToolsMatch = path.match(/^\/api\/projects\/([^/]+)\/shell-tools$/);
    if (shellToolsMatch && request.method === 'GET') {
      const projectId = shellToolsMatch[1];
      return this.handleGetShellTools(projectId);
    }

    // Disconnect OAuth2
    const oauth2DisconnectMatch = path.match(/^\/api\/projects\/([^/]+)\/oauth\/([^/]+)$/);
    if (oauth2DisconnectMatch && request.method === 'DELETE') {
      const projectId = oauth2DisconnectMatch[1];
      const serverId = oauth2DisconnectMatch[2];
      return this.handleOAuth2Disconnect(projectId, serverId);
    }

    // Token refresh scheduler status
    if (path === '/api/token-refresh/status' && request.method === 'GET') {
      return this.handleTokenRefreshStatus();
    }

    // Force token refresh check
    if (path === '/api/token-refresh/check' && request.method === 'POST') {
      return this.handleForceTokenRefresh();
    }

    // Git integrations endpoints
    if (path === '/api/integrations' && request.method === 'GET') {
      return this.handleGetIntegrations();
    }

    // GitHub OAuth flow
    const githubOAuthStartMatch = path.match(/^\/api\/integrations\/github\/oauth\/start$/);
    if (githubOAuthStartMatch && request.method === 'POST') {
      return this.handleGitHubOAuthStart(request);
    }
    
    const githubOAuthCallbackMatch = path.match(/^\/api\/integrations\/github\/oauth\/callback$/);
    if (githubOAuthCallbackMatch && (request.method === 'POST' || request.method === 'GET')) {
      return this.handleGitHubOAuthCallback(request);
    }

    // GitLab OAuth flow
    const gitlabOAuthStartMatch = path.match(/^\/api\/integrations\/gitlab\/oauth\/start$/);
    if (gitlabOAuthStartMatch && request.method === 'POST') {
      return this.handleGitLabOAuthStart(request);
    }

    const gitlabOAuthCallbackMatch = path.match(/^\/api\/integrations\/gitlab\/oauth\/callback$/);
    if (gitlabOAuthCallbackMatch && (request.method === 'POST' || request.method === 'GET')) {
      return this.handleGitLabOAuthCallback(request);
    }

    // Git integration token refresh
    const gitTokenRefreshMatch = path.match(/^\/api\/integrations\/(github|gitlab)\/refresh$/);
    if (gitTokenRefreshMatch) {
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({ error: 'Method not allowed. Use POST.' }),
          { status: 405, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (request.method === 'POST') {
        const platform = gitTokenRefreshMatch[1] as 'github' | 'gitlab';
        return this.handleGitTokenRefresh(platform);
      }
    }

    // GitHub Enterprise PAT
    if (path === '/api/integrations/github-enterprise' && request.method === 'POST') {
      return this.handleGitHubEnterprisePAT(request);
    }

    // GitLab Self-Managed PAT
    if (path === '/api/integrations/gitlab-self-managed' && request.method === 'POST') {
      return this.handleGitLabSelfManagedPAT(request);
    }

    // Disconnect integration
    const disconnectMatch = path.match(/^\/api\/integrations\/([^/]+)(?:\/([^/]+))?$/);
    if (disconnectMatch && request.method === 'DELETE') {
      const platform = disconnectMatch[1];
      const host = disconnectMatch[2];
      return this.handleDisconnectIntegration(platform, host);
    }

    // --- Registry endpoints ---

    if (path === '/api/registries' && request.method === 'GET') {
      return this.handleGetRegistries();
    }

    const registrySearchMatch = path.match(/^\/api\/registries\/([^/]+)\/search$/);
    if (registrySearchMatch && request.method === 'GET') {
      const registryId = decodeURIComponent(registrySearchMatch[1]);
      return this.handleRegistrySearch(registryId, url);
    }

    // view uses a wildcard tail so item IDs containing slashes work (e.g. "owner/repo/slug")
    const registryViewMatch = path.match(/^\/api\/registries\/([^/]+)\/view\/(.+)$/);
    if (registryViewMatch && request.method === 'GET') {
      const registryId = decodeURIComponent(registryViewMatch[1]);
      const itemId = decodeURIComponent(registryViewMatch[2]);
      return this.handleRegistryView(registryId, itemId, url);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleGetProjects(): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Get all projects');
    try {
      const projects = this.db.getAllProjects();
      
      // Enrich projects with additional data
      const enrichedProjects = projects.map((project) => {
        const capabilities = this.sessionManager.getProjectCapabilities(project.id);
        return {
          id: project.id,
          path: project.path,
          created_at: project.created_at,
          updated_at: project.updated_at,
          skills_count: capabilities?.skills?.length || 0,
          tools_count: capabilities?.tools?.length || 0,
          servers_count: capabilities?.servers?.length || 0,
        };
      });

      apiLogger.info(`Found ${enrichedProjects.length} project(s)`);
      return new Response(
        JSON.stringify({ projects: enrichedProjects }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleGetProject(projectId: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Get project: ${projectId}`);
    try {
      const project = this.db.getProject(projectId);
      if (!project) {
        return new Response(
          JSON.stringify({ error: 'Project not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const capabilities = this.sessionManager.getProjectCapabilities(projectId);
      
      const projectDetails = {
        id: project.id,
        path: project.path,
        created_at: project.created_at,
        updated_at: project.updated_at,
        capabilities: capabilities ? {
          skills: capabilities.skills.map(s => ({
            id: s.id,
            type: s.type,
            description: s.def?.description || null,
            requires: s.def?.requires || [],
            sourcePlugin: s.sourcePlugin || null,
          })),
          tools: capabilities.tools.map(t => {
            const base: Record<string, any> = {
              id: t.id,
              type: t.type,
              sourcePlugin: t.sourcePlugin || null,
            };
            if (t.type === 'mcp') {
              const mcpDef = t.def as ToolMCPDefinition;
              base.mcpServer = mcpDef.server;
              base.mcpTool = mcpDef.tool;
            } else if (t.type === 'command') {
              const cmdDef = t.def as ToolCommandDefinition;
              base.command = cmdDef.run.cmd;
              base.commandArgs = cmdDef.run.args || [];
            }
            return base;
          }),
          servers: capabilities.servers.map(s => {
            const requiresOAuth = !!s.def?.oauth2;
            const isConnected = requiresOAuth
              ? this.oauth2Manager.isServerConnected(projectId, s.id)
              : null; // null = no auth needed, not applicable
            return {
              id: s.id,
              type: s.type,
              url: s.def?.url || null,
              cmd: s.def?.cmd || null,
              args: s.def?.args || null,
              sourcePlugin: s.sourcePlugin || null,
              displayName: s.displayName || null,
              requiresOAuth,
              isConnected,
            };
          }),
          resolvedPlugins: capabilities.resolvedPlugins || null,
          providers: capabilities.providers || [],
          subagents: (capabilities.subagents || []).map(sa => ({
            id: sa.id,
            description: sa.description || null,
            skills: sa.skills,
            tools: sa.tools,
            instructions: sa.instructions || null,
          })),
          rules: (capabilities.rules || []).map(r => ({
            id: r.id,
            type: r.type,
            description: r.description || null,
            providers: r.providers || [],
            appliesTo: r.appliesTo || [],
            alwaysApply: r.alwaysApply || false,
          })),
          options: capabilities.options ? {
            toolExposure: capabilities.options.toolExposure || null,
            security: capabilities.options.security ? {
              blockedPhrases: capabilities.options.security.blockedPhrases || [],
              allowedCharacters: capabilities.options.security.allowedCharacters || null,
            } : null,
            requiresCommands: (capabilities.options.requiresCommands || []).map(c => ({
              cli: c.cli,
              description: c.description || null,
            })),
          } : null,
        } : null,
      };

      apiLogger.success('Project found');
      return new Response(
        JSON.stringify(projectDetails),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private getOrCreateMCPServer(projectId: string, agentId?: string): CapaMCPServer | null {
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
      agentId
    );
    this.mcpServers.set(cacheKey, mcpServer);
    return mcpServer;
  }

  private async handleGetServerTools(projectId: string, serverId: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`List tools for server: ${serverId} in project: ${projectId}`);
    try {
      const capabilities = this.sessionManager.getProjectCapabilities(projectId);
      if (!capabilities) {
        return new Response(
          JSON.stringify({ error: 'Project not configured' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const server = capabilities.servers.find(s => s.id === serverId);
      if (!server) {
        return new Response(
          JSON.stringify({ error: 'Server not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const mcpServer = this.getOrCreateMCPServer(projectId);
      if (!mcpServer) {
        return new Response(
          JSON.stringify({ error: 'Project not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const tools = await mcpServer.listServerTools(serverId, capabilities);
      apiLogger.success(`Found ${tools.length} tools for server ${serverId}`);
      return new Response(
        JSON.stringify({ tools }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleGetShellTools(projectId: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Get shell tools for project: ${projectId}`);
    try {
      const capabilities = this.sessionManager.getProjectCapabilities(projectId);
      if (!capabilities) {
        return new Response(
          JSON.stringify({ error: 'Project not configured' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const mcpServer = this.getOrCreateMCPServer(projectId);
      if (!mcpServer) {
        return new Response(
          JSON.stringify({ error: 'Project not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const tools: ShellToolInfo[] = await mcpServer.getAllShellTools(capabilities);
      apiLogger.success(`Found ${tools.length} shell tools for project ${projectId}`);
      return new Response(
        JSON.stringify({ tools }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleProjectConfigure(projectId: string, request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    try {
      apiLogger.info(`Configure project: ${projectId}`);
      const capabilities: Capabilities = await request.json();
      apiLogger.info(`Skills: ${capabilities.skills.map(s => s.id).join(', ')}`);
      apiLogger.info(`Tools: ${capabilities.tools.length}`);
      apiLogger.info(`Servers: ${capabilities.servers.length}`);

      // Store capabilities
      this.sessionManager.setProjectCapabilities(projectId, capabilities);

      const capabilitiesToUse = capabilities;

      // Detect OAuth2 requirements for HTTP-based MCP servers
      apiLogger.info('Detecting OAuth2 requirements...');
      const oauth2Servers: any[] = [];
      for (const server of capabilitiesToUse.servers) {
        if (server.def.url) {
          apiLogger.debug(`Checking server: ${server.id}`);
          const existingOAuth = server.def.oauth2;

          // Skip OAuth2 detection for servers that already have explicit auth headers —
          // probing them with an unauthenticated request is unnecessary and can interfere
          // with token-based connections (e.g. Databricks 401 probe, GitLab TLS errors).
          const hasExplicitAuth = server.def.headers &&
            Object.keys(server.def.headers).some(k => k.toLowerCase() === 'authorization');
          if (hasExplicitAuth) {
            apiLogger.debug(`Skipping OAuth2 detection for ${server.id} (explicit auth header configured)`);
            continue;
          }

          const oauth2Config = await this.oauth2Manager.detectOAuth2Requirement(server.def.url, { tlsSkipVerify: server.def.tlsSkipVerify });
          if (oauth2Config) {
            apiLogger.debug(`OAuth2 required for ${server.id}`);
            let isConnected = this.oauth2Manager.isServerConnected(projectId, server.id);
            
            // Validate existing connection by attempting to get a valid token
            // This will trigger token refresh if needed and delete invalid tokens
            if (isConnected) {
              const accessToken = await this.oauth2Manager.getAccessToken(projectId, server.id, oauth2Config);
              isConnected = !!accessToken;
              if (!isConnected) {
                apiLogger.warn(`OAuth2 token invalid/expired for ${server.id}`);
              }
            }
            
            // Merge: preserve every embedded field from the plugin/MCP config (e.g. Slack
            // .mcp.json) and overlay the discovered endpoints on top. Embedded values for
            // `client_id` and `callback_port` always win — auth servers register specific
            // (client_id, redirect_uri) pairs and dropping either breaks the flow.
            const merged: any = { ...(existingOAuth ?? {}), ...oauth2Config };
            const embeddedClientId =
              (existingOAuth as any)?.client_id ??
              (existingOAuth as any)?.clientId ??
              (existingOAuth as any)?.CLIENT_ID ??
              (existingOAuth as any)?.oauth?.clientId ??
              (existingOAuth as any)?.oauth?.client_id;
            if (embeddedClientId) merged.client_id = embeddedClientId;
            const embeddedCallbackPort =
              (existingOAuth as any)?.callback_port ??
              (existingOAuth as any)?.callbackPort ??
              (existingOAuth as any)?.CALLBACK_PORT;
            if (typeof embeddedCallbackPort === 'number' && embeddedCallbackPort > 0) {
              merged.callback_port = embeddedCallbackPort;
            } else if (typeof embeddedCallbackPort === 'string') {
              const parsed = Number(embeddedCallbackPort);
              if (Number.isFinite(parsed) && parsed > 0) merged.callback_port = parsed;
            }
            apiLogger.debug(
              `OAuth2 merged for ${server.id}: client_id=${merged.client_id ? 'set' : 'missing'} callback_port=${merged.callback_port ?? 'missing'} registrationEndpoint=${merged.registrationEndpoint ? 'set' : 'missing'}`,
            );
            server.def.oauth2 = merged;
            oauth2Servers.push({
              serverId: server.id,
              serverUrl: server.def.url,
              displayName: server.displayName ?? server.id,
              isConnected: isConnected,
            });
          }
        }
      }

      // Update stored capabilities with OAuth2 configs
      if (oauth2Servers.length > 0) {
        this.sessionManager.setProjectCapabilities(projectId, capabilitiesToUse);
      }

      // Extract all required variables
      const requiredVars = extractAllVariables(capabilitiesToUse);
      apiLogger.info(`Required variables: ${requiredVars.join(', ')}`);

      // Check if all variables are set
      const missingVars: string[] = [];
      for (const varName of requiredVars) {
        const value = this.db.getVariable(projectId, varName);
        if (!value) {
          missingVars.push(varName);
        }
      }

      // Check if OAuth2 servers need connection
      const needsOAuth2Connection = oauth2Servers.some(s => !s.isConnected);

      // Validate tools (check if MCP tools exist on remote servers)
      apiLogger.info('Validating tools...');
      let toolValidationResults: any[] = [];
      try {
        const mcpServer = this.getOrCreateMCPServer(projectId);
        if (mcpServer) {
          toolValidationResults = await mcpServer.validateTools(capabilitiesToUse);
        }
        
        // Filter out validation failures for OAuth2 servers that need connection
        const oauth2ServerIds = new Set(oauth2Servers.filter(s => !s.isConnected).map(s => s.serverId));
        const nonOAuth2ValidationResults = toolValidationResults.filter(r => !oauth2ServerIds.has(r.serverId));
        const oauth2PendingResults = toolValidationResults.filter(r => oauth2ServerIds.has(r.serverId));
        
        if (oauth2PendingResults.length > 0) {
          apiLogger.info(`${oauth2PendingResults.length} tool(s) skipped validation (OAuth2 authentication required)`);
          // Mark OAuth2 tools as pending authentication
          for (const pending of oauth2PendingResults) {
            pending.success = true; // Don't mark as failed
            pending.pendingAuth = true;
            pending.error = undefined;
          }
        }
        
        const failedTools = nonOAuth2ValidationResults.filter(r => !r.success);
        if (failedTools.length > 0) {
          apiLogger.warn(`${failedTools.length} tool(s) failed validation`);
          for (const failed of failedTools) {
            apiLogger.debug(`  ${failed.toolId}: ${failed.error}`);
          }
        } else if (nonOAuth2ValidationResults.length > 0) {
          apiLogger.success(`All ${nonOAuth2ValidationResults.length} non-OAuth2 tool(s) validated successfully`);
        }
      } catch (error: any) {
        apiLogger.failure(`Tool validation error: ${error.message}`);
        // Continue even if validation fails - this is informational
      }

      if (missingVars.length > 0 || needsOAuth2Connection) {
        apiLogger.warn(`Missing variables: ${missingVars.join(', ')}`);
        if (needsOAuth2Connection) {
          apiLogger.warn(`OAuth2 connections needed: ${oauth2Servers.filter(s => !s.isConnected).map(s => s.serverId).join(', ')}`);
        }
        const credentialsUrl = projectUiUrl(this.uiOrigin(), projectId);
        
        return new Response(
          JSON.stringify({
            success: false,
            needsCredentials: true,
            missingVariables: missingVars,
            oauth2Servers: oauth2Servers,
            credentialsUrl,
            toolValidation: toolValidationResults,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      apiLogger.success('Project configured successfully');
      return new Response(
        JSON.stringify({
          success: true,
          needsCredentials: false,
          toolValidation: toolValidationResults,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  private async handleGetVariables(projectId: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Get variables for project: ${projectId}`);
    const capabilities = this.sessionManager.getProjectCapabilities(projectId);
    if (!capabilities) {
      apiLogger.warn('Project not configured');
      return new Response(
        JSON.stringify({ error: 'Project not configured' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const requiredVars = extractAllVariables(capabilities);
    const values = this.db.getAllVariables(projectId);
    apiLogger.info(`Required: ${requiredVars.length}, Set: ${Object.keys(values).length}`);

    return new Response(
      JSON.stringify({
        required: requiredVars,
        values,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  private async handleSetVariables(projectId: string, request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    try {
      apiLogger.info(`Set variables for project: ${projectId}`);
      const variables: Record<string, string> = await request.json();

      for (const [key, value] of Object.entries(variables)) {
        apiLogger.debug(`Setting: ${key} = ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}`);
        this.db.setVariable(projectId, key, value);
      }

      apiLogger.success(`Set ${Object.keys(variables).length} variable(s)`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  private async handleGetOAuth2Servers(projectId: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Get OAuth2 servers for project: ${projectId}`);
    const capabilities = this.sessionManager.getProjectCapabilities(projectId);
    if (!capabilities) {
      return new Response(
        JSON.stringify({ error: 'Project not configured' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Ensure URL-based servers that require OAuth have def.oauth2 set (on-demand detection)
    let capabilitiesUpdated = false;
    for (const server of capabilities.servers) {
      const hasExplicitAuthOnDemand = server.def.headers &&
        Object.keys(server.def.headers).some(k => k.toLowerCase() === 'authorization');
      if (server.def.url && !server.def.oauth2 && !hasExplicitAuthOnDemand) {
        const oauth2Config = await this.oauth2Manager.detectOAuth2Requirement(server.def.url, { tlsSkipVerify: server.def.tlsSkipVerify });
        if (oauth2Config) {
          apiLogger.debug(`OAuth2 detected for ${server.id} (on-demand)`);
          server.def.oauth2 = oauth2Config;
          capabilitiesUpdated = true;
        }
      }
    }
    if (capabilitiesUpdated) {
      this.sessionManager.setProjectCapabilities(projectId, capabilities);
    }

    const oauth2Servers = capabilities.servers
      .filter((s: any) => s.def.oauth2)
      .map((s: MCPServer) => {
        const isConnected = this.oauth2Manager.isServerConnected(projectId, s.id);
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

    return new Response(
      JSON.stringify({ servers: oauth2Servers }),
      { headers: { 'Content-Type': 'application/json' } }
    );
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
  private async ensureOAuthCallbackServer(startPort: number, maxAttempts = 10): Promise<number> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = startPort + attempt;
      if (this.oauthCallbackServers.has(port)) {
        return port;
      }
      try {
        await this.bindOAuthCallbackServer(port);
        return port;
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE') {
          this.logger.warn(`OAuth callback port ${port} in use, trying ${port + 1}`);
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
        if (req.method !== 'GET' || !req.url) {
          res.writeHead(405);
          res.end();
          return;
        }
        const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        const entry = self.oauthCallbackServers.get(port);
        if (entry) clearTimeout(entry.idleTimer);
        const closeWhenDone = () => {
          res.on('finish', () => self.closeOAuthCallbackServer(port));
        };

        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');
        const apiLogger = self.logger.child('API');

        const redirectToUi = (
          projectId: string | undefined,
          success: boolean,
          message?: string,
          serverId?: string
        ) => {
          closeWhenDone();
          const loc = projectId
            ? projectUiUrl(mainBase, projectId, {
                ...(success
                  ? { oauth_success: message ?? 'true' }
                  : { oauth_error: message ?? 'Unknown error' }),
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
          redirectToUi(undefined, false, 'Missing code or state');
          return;
        }

        apiLogger.info('OAuth2 callback (Claude-style) received');
        self.oauth2Manager.handleCallback(code, state).then((result) => {
          if (!result.success) {
            apiLogger.failure(`Callback failed: ${result.error}`);
            redirectToUi(result.projectId, false, result.error ?? 'Token exchange failed');
            return;
          }
          apiLogger.success(`OAuth2 flow completed for server: ${result.serverId}`);
          redirectToUi(result.projectId, true, 'true', result.serverId);
        }).catch((err: any) => {
          apiLogger.failure(`Callback error: ${err.message}`);
          redirectToUi(undefined, false, err.message ?? 'Token exchange failed');
        });
      });

      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        self.logger.info(`OAuth callback server (Claude-style) listening on http://localhost:${port}/callback`);
        const idleTimer = setTimeout(() => {
          self.logger.debug(`OAuth callback server on port ${port} idle for 5 min, closing`);
          self.closeOAuthCallbackServer(port);
        }, IDLE_MS);
        self.oauthCallbackServers.set(port, { server, idleTimer });
        server.on('error', (err: any) => {
          self.logger.failure(`OAuth callback server on port ${port}: ${err.message}`);
          self.closeOAuthCallbackServer(port);
        });
        resolve();
      });
    });
  }

  private async handleOAuth2Start(projectId: string, request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    try {
      const url = new URL(request.url);
      const serverId = url.searchParams.get('server');
      
      if (!serverId) {
        return new Response(
          JSON.stringify({ error: 'Missing server parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      apiLogger.info(`Start OAuth2 flow for server: ${serverId}`);
      
      const capabilities = this.sessionManager.getProjectCapabilities(projectId);
      if (!capabilities) {
        return new Response(
          JSON.stringify({ error: 'Project not configured' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const server = capabilities.servers.find((s: any) => s.id === serverId);
      if (!server || !server.def.oauth2) {
        return new Response(
          JSON.stringify({ error: 'Server not found or does not require OAuth2' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const oauth2 = server.def.oauth2 as {
        client_id?: string; clientId?: string; CLIENT_ID?: string;
        callback_port?: number | string; callbackPort?: number | string; CALLBACK_PORT?: number | string;
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
      if (typeof callbackPortRaw === 'number' && callbackPortRaw > 0) {
        effectiveCallbackPort = callbackPortRaw;
      } else if (typeof callbackPortRaw === 'string') {
        const parsed = Number(callbackPortRaw);
        if (Number.isFinite(parsed) && parsed > 0) effectiveCallbackPort = parsed;
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
        `OAuth2 redirect for ${serverId}: ${redirectUri} (useClaudeCallback=${useClaudeCallback}, client_id=${effectiveClientId ? 'set' : 'missing'}, callback_port=${effectiveCallbackPort ?? 'missing'}, registrationEndpoint=${oauth2.registrationEndpoint ? 'set' : 'missing'})`,
      );

      // Ensure the OAuth2Config we hand to the manager has the canonical snake_case
      // client_id populated so generateAuthorizationUrl emits the embedded app id.
      const configForFlow: OAuth2Config = {
        ...(server.def.oauth2 as OAuth2Config),
        ...(effectiveClientId ? { client_id: effectiveClientId } : {}),
      };

      const { url: authUrl, state } = await this.oauth2Manager.generateAuthorizationUrl(
        projectId,
        serverId,
        configForFlow,
        redirectUri
      );

      apiLogger.success('Authorization URL generated');
      return new Response(
        JSON.stringify({ authorizationUrl: authUrl, state }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleOAuth2Callback(projectId: string, request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    try {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        apiLogger.error(`OAuth2 callback error: ${error}`);
        const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, { oauth_error: error });
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      if (!code || !state) {
        return new Response(
          JSON.stringify({ error: 'Missing code or state parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      apiLogger.info(`OAuth2 callback for project: ${projectId}`);
      
      const result = await this.oauth2Manager.handleCallback(code, state);
      
      if (!result.success) {
        apiLogger.failure(`Callback failed: ${result.error}`);
        const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, {
          oauth_error: result.error || 'Unknown error',
        });
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      apiLogger.success(`OAuth2 flow completed for server: ${result.serverId}`);

      const redirectUrl = projectUiUrl(this.uiOrigin(), projectId, {
        oauth_success: 'true',
        ...(result.serverId ? { server: result.serverId } : {}),
      });
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    } catch (error: any) {
      const apiLogger = this.logger.child('API');
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

  private async handleOAuth2Disconnect(projectId: string, serverId: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Disconnect OAuth2 for server: ${serverId}`);
    try {
      this.oauth2Manager.disconnect(projectId, serverId);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleTokenRefreshStatus(): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Get token refresh scheduler status');
    try {
      const status = this.tokenRefreshScheduler.getStatus();
      return new Response(
        JSON.stringify(status),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleForceTokenRefresh(): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Force token refresh check');
    try {
      await this.tokenRefreshScheduler.forceCheck();
      return new Response(
        JSON.stringify({ success: true, message: 'Token refresh check completed' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Git Integration handlers

  private async handleGetIntegrations(): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Get all integrations');
    try {
      const integrations = this.gitIntegrationManager.getAllIntegrations();
      return new Response(
        JSON.stringify({ integrations }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleGitHubOAuthStart(request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Start GitHub OAuth flow');
    try {
      // Cloud OAuth endpoint will handle the entire OAuth flow
      // and redirect back to our local callback with the access token
      const localCallbackUri = `http://${this.settings.server.host}:${this.settings.server.port}/api/integrations/github/oauth/callback`;
      
      const { url: authUrl, flowId } = await this.gitIntegrationManager.generateAuthorizationUrl(
        'github',
        localCallbackUri
      );

      apiLogger.success('GitHub authorization URL generated (via cloud)');
      return new Response(
        JSON.stringify({ authorizationUrl: authUrl, flowId }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * GitHub OAuth callback. Tokens must be sent via POST JSON body, not URL query strings.
   *
   * POST /api/integrations/github/oauth/callback
   * Body: { "access_token": "...", "refresh_token": "...", "expires_in": 3600 }
   *
   * GET is only supported for error redirects without tokens (?error=...).
   */
  private async handleGitHubOAuthCallback(request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    try {
      let accessToken: string | null = null;
      let refreshToken: string | undefined;
      let expiresIn: number | undefined;
      let error: string | null = null;

      if (request.method === 'POST') {
        const body = await request.json() as Record<string, unknown>;
        accessToken = typeof body.access_token === 'string' ? body.access_token : null;
        refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
        if (body.expires_in != null) {
          expiresIn = parseInt(String(body.expires_in), 10);
        }
        error = typeof body.error === 'string' ? body.error : null;
      } else {
        const url = new URL(request.url);
        // Cloud OAuth provider redirects via GET with tokens in the query string. Serve
        // a tiny HTML+JS bridge that strips tokens from the URL and re-issues the
        // callback as a POST (the spec-compliant ingress hardened by #S3).
        if (
          url.searchParams.has('access_token') ||
          url.searchParams.has('refresh_token') ||
          url.searchParams.has('token')
        ) {
          apiLogger.info('GitHub OAuth callback (cloud GET redirect) — serving bridge');
          return oauthBridgeResponse('github');
        }
        error = url.searchParams.get('error');
      }

      if (error) {
        apiLogger.error(`GitHub OAuth callback error: ${error}`);
        const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?error=${encodeURIComponent(error)}`;
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: 'Missing access_token parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      apiLogger.info('GitHub OAuth callback (from cloud)');
      // Pass 'github' as the platform since this is the GitHub callback endpoint
      const result = await this.gitIntegrationManager.handleCallback(
        accessToken,
        'github',
        refreshToken,
        expiresIn
      );

      if (!result.success) {
        apiLogger.failure(`Callback failed: ${result.error}`);
        const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?error=${encodeURIComponent(result.error || 'Unknown error')}`;
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      apiLogger.success('GitHub OAuth flow completed');
      const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?success=github`;
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?error=${encodeURIComponent(error.message)}`;
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    }
  }

  private async handleGitLabOAuthStart(request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Start GitLab OAuth flow');
    try {
      // Cloud OAuth endpoint will handle the entire OAuth flow
      // and redirect back to our local callback with the access token
      const localCallbackUri = `http://${this.settings.server.host}:${this.settings.server.port}/api/integrations/gitlab/oauth/callback`;
      
      const { url: authUrl, flowId } = await this.gitIntegrationManager.generateAuthorizationUrl(
        'gitlab',
        localCallbackUri
      );

      apiLogger.success('GitLab authorization URL generated (via cloud)');
      return new Response(
        JSON.stringify({ authorizationUrl: authUrl, flowId }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * GitLab OAuth callback. Tokens must be sent via POST JSON body, not URL query strings.
   *
   * POST /api/integrations/gitlab/oauth/callback
   * Body: { "access_token": "...", "refresh_token": "...", "expires_in": 3600 }
   *
   * GET is only supported for error redirects without tokens (?error=...).
   */
  private async handleGitLabOAuthCallback(request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    try {
      let accessToken: string | null = null;
      let refreshToken: string | undefined;
      let expiresIn: number | undefined;
      let error: string | null = null;

      if (request.method === 'POST') {
        const body = await request.json() as Record<string, unknown>;
        accessToken = typeof body.access_token === 'string' ? body.access_token : null;
        refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
        if (body.expires_in != null) {
          expiresIn = parseInt(String(body.expires_in), 10);
        }
        error = typeof body.error === 'string' ? body.error : null;
      } else {
        const url = new URL(request.url);
        // Cloud OAuth provider redirects via GET with tokens in the query string. Serve
        // a tiny HTML+JS bridge that strips tokens from the URL and re-issues the
        // callback as a POST (the spec-compliant ingress hardened by #S3).
        if (
          url.searchParams.has('access_token') ||
          url.searchParams.has('refresh_token') ||
          url.searchParams.has('token')
        ) {
          apiLogger.info('GitLab OAuth callback (cloud GET redirect) — serving bridge');
          return oauthBridgeResponse('gitlab');
        }
        error = url.searchParams.get('error');
      }

      if (error) {
        apiLogger.error(`GitLab OAuth callback error: ${error}`);
        const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?error=${encodeURIComponent(error)}`;
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: 'Missing access_token parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      apiLogger.info('GitLab OAuth callback (from cloud)');
      // Pass 'gitlab' as the platform since this is the GitLab callback endpoint
      const result = await this.gitIntegrationManager.handleCallback(
        accessToken,
        'gitlab',
        refreshToken,
        expiresIn
      );

      if (!result.success) {
        apiLogger.failure(`Callback failed: ${result.error}`);
        const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?error=${encodeURIComponent(result.error || 'Unknown error')}`;
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      apiLogger.success('GitLab OAuth flow completed');
      const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?success=gitlab`;
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui/integrations?error=${encodeURIComponent(error.message)}`;
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    }
  }

  /**
   * Refresh stored OAuth token for a git platform. Requires POST; tokens must not appear in URLs.
   *
   * curl -X POST http://localhost:3000/api/integrations/github/refresh
   */
  private async handleGitTokenRefresh(platform: 'github' | 'gitlab'): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Refresh ${platform} token`);
    try {
      const success = await this.gitIntegrationManager.refreshAccessToken(platform);

      if (!success) {
        apiLogger.failure('Token refresh failed');
        return new Response(
          JSON.stringify({ success: false, error: 'Token refresh failed. Re-authentication may be required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      apiLogger.success(`${platform} token refreshed successfully`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleGitHubEnterprisePAT(request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Store GitHub Enterprise PAT');
    try {
      const body = await request.json();
      const { host, token } = body;

      if (!host || !token) {
        return new Response(
          JSON.stringify({ error: 'Missing host or token' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await this.gitIntegrationManager.storePAT({
        platform: 'github-enterprise',
        host,
        token,
      });

      apiLogger.success(`GitHub Enterprise PAT stored for ${host}`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleGitLabSelfManagedPAT(request: Request): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('Store GitLab Self-Managed PAT');
    try {
      const body = await request.json();
      const { host, token } = body;

      if (!host || !token) {
        return new Response(
          JSON.stringify({ error: 'Missing host or token' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await this.gitIntegrationManager.storePAT({
        platform: 'gitlab-self-managed',
        host,
        token,
      });

      apiLogger.success(`GitLab Self-Managed PAT stored for ${host}`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleDisconnectIntegration(platform: string, host?: string): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Disconnect integration: ${platform}${host ? ` at ${host}` : ''}`);
    try {
      this.gitIntegrationManager.disconnect(platform as any, host);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // --- Registry handlers ---

  private async handleGetRegistries(): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info('List registries');
    try {
      const manifests = await this.registryManager.list();
      return new Response(
        JSON.stringify({ registries: manifests }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Error listing registries: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleRegistrySearch(registryId: string, url: URL): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Registry search: ${registryId}`);
    try {
      const capability = (url.searchParams.get('capability') ?? 'skills') as RegistryCapability;
      const query = url.searchParams.get('q') ?? undefined;
      const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
      const cursor = url.searchParams.get('cursor') ?? undefined;

      const result = await this.registryManager.search(registryId, { capability, query, limit, cursor });
      return new Response(
        JSON.stringify(result),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Registry search error: ${error.message}`);
      const status = error.message.includes('not found') ? 404 : 502;
      return new Response(
        JSON.stringify({ error: error.message, registry: registryId }),
        { status, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleRegistryView(registryId: string, itemId: string, url: URL): Promise<Response> {
    const apiLogger = this.logger.child('API');
    apiLogger.info(`Registry view: ${registryId} / ${itemId}`);
    try {
      const capability = (url.searchParams.get('capability') ?? 'skills') as RegistryCapability;
      const detail = await this.registryManager.view(registryId, { capability, id: itemId });
      return new Response(
        JSON.stringify(detail),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      apiLogger.failure(`Registry view error: ${error.message}`);
      const status = error.message.includes('not found') ? 404 : 502;
      return new Response(
        JSON.stringify({ error: error.message, registry: registryId }),
        { status, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleMCP(request: Request, projectId: string, agentId?: string): Promise<Response> {
    const mcpLogger = this.logger.child('MCP');
    const cacheKey = agentId ? `${projectId}:${agentId}` : projectId;

    // Get or create MCP server for this project (or project+sub-agent)
    let mcpServer = this.mcpServers.get(cacheKey);

    if (!mcpServer) {
      const label = agentId ? `project: ${projectId}, sub-agent: ${agentId}` : `project: ${projectId}`;
      mcpLogger.info(`Creating new MCP server for ${label}`);
      // Get project from database
      const project = this.db.getProject(projectId);
      if (!project) {
        mcpLogger.warn('Project not found');
        return new Response('Project not found', { status: 404 });
      }

      mcpServer = new CapaMCPServer(
        this.db,
        this.sessionManager,
        projectId,
        project.path,
        agentId
      );

      this.mcpServers.set(cacheKey, mcpServer);
      mcpLogger.success('MCP server created');
    }

    const requestOrigin = request.headers.get('Origin');
    const originCheck = isAllowedOrigin(requestOrigin);
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (originCheck.origin) {
      corsHeaders['Access-Control-Allow-Origin'] = originCheck.origin;
    }

    // Handle MCP protocol via HTTP (simplified without SSE)
    if (request.method === 'POST') {
      if (requestOrigin && !originCheck.allowed) {
        return new Response(
          `Origin ${requestOrigin} not allowed. Set CAPA_ALLOWED_ORIGINS env var to include this origin.`,
          { status: 403 }
        );
      }

      try {
        const message = await request.json();
        mcpLogger.debug(`${message.method || 'notification'} (id: ${message.id || 'none'})`);
        
        // Handle JSON-RPC message
        const result = await mcpServer.handleMessage(message);
        
        // Return simple JSON response (not SSE)
        return new Response(
          JSON.stringify(result),
          {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      } catch (error: any) {
        mcpLogger.failure(`Error: ${error.message}`);
        return new Response(
          JSON.stringify({ 
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: error.message || 'Internal error'
            },
            id: null
          }),
          {
            status: mcpHandlerHttpStatus(error),
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }
    }

    // Handle OPTIONS for CORS
    if (request.method === 'OPTIONS') {
      if (requestOrigin && !originCheck.allowed) {
        return new Response(
          `Origin ${requestOrigin} not allowed. Set CAPA_ALLOWED_ORIGINS env var to include this origin.`,
          { status: 403 }
        );
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    return new Response('Method not allowed', { status: 405 });
  }

  private writePidFile() {
    const pidFile = getPidFilePath();
    const content = `${process.pid}:${VERSION}`;
    writeFileSync(pidFile, content, 'utf-8');
  }

  async stop() {
    this.logger.info('Stopping CAPA server...');

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
    this.db.close();

    this.logger.success('CAPA server stopped');
    process.exit(0);
  }
}

// Main
const server = new CapaServer();

// Handle shutdown signals
process.on('SIGTERM', () => server.stop());
process.on('SIGINT', () => server.stop());

// Start server
server.start().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
