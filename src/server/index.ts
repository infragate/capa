import { writeFileSync } from 'fs';
import { join } from 'path';
import { Server as HttpServer } from 'http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadSettings, getDatabasePath, getPidFilePath, ensureCapaDir } from '../shared/config';
import { CapaDatabase } from '../db/database';
import { SessionManager } from './session-manager';
import { SubprocessManager } from './subprocess-manager';
import { CapaMCPServer } from './mcp-handler';
import { OAuth2Manager } from './oauth-manager';
import { TokenRefreshScheduler } from './token-refresh-scheduler';
import type { Capabilities } from '../types/capabilities';
import { extractAllVariables } from '../shared/variable-resolver';
import { VERSION } from '../version';

class CapaServer {
  private db!: CapaDatabase;
  private sessionManager!: SessionManager;
  private subprocessManager!: SubprocessManager;
  private oauth2Manager!: OAuth2Manager;
  private tokenRefreshScheduler!: TokenRefreshScheduler;
  private httpServer!: HttpServer;
  private settings: any;
  private mcpServers = new Map<string, CapaMCPServer>();
  private startTime: number = Date.now();

  async start() {
    console.log('Starting CAPA server...');

    // Load settings
    this.settings = await loadSettings();

    // Ensure .capa directory exists
    await ensureCapaDir();

    // Initialize database
    const dbPath = getDatabasePath(this.settings);
    this.db = new CapaDatabase(dbPath);

    // Initialize managers
    this.sessionManager = new SessionManager(this.db);
    this.subprocessManager = new SubprocessManager(this.db);
    this.oauth2Manager = new OAuth2Manager(this.db);
    
    // Connect OAuth2Manager with SessionManager for capabilities access
    this.oauth2Manager.setCapabilitiesProvider(() => this.sessionManager.getAllProjectCapabilities());

    // Initialize and start token refresh scheduler
    this.tokenRefreshScheduler = new TokenRefreshScheduler(
      this.db,
      this.oauth2Manager,
      {
        checkInterval: 60000,      // Check every 1 minute
        refreshThreshold: 600000,  // Refresh tokens expiring within 10 minutes
        debug: false,              // Set to true to see detailed logs
      }
    );
    this.tokenRefreshScheduler.setCapabilitiesProvider(() => this.sessionManager.getAllProjectCapabilities());
    this.tokenRefreshScheduler.start();
    console.log('✓ Token refresh scheduler started');

    // Start HTTP server
    await this.startHttpServer();

    // Write PID file
    this.writePidFile();

    console.log(`✓ CAPA server running at http://${this.settings.server.host}:${this.settings.server.port}`);
    console.log(`  Version: ${VERSION}`);
  }

  private async startHttpServer() {
    const { host, port } = this.settings.server;
    const self = this;

    const server = Bun.serve({
      hostname: host,
      port: port,
      async fetch(request, server) {
        return await self.handleRequest(request, server);
      },
    });

    console.log(`HTTP server listening on ${host}:${port}`);
  }

  private async handleRequest(request: Request, server: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    console.log(`[${new Date().toISOString()}] ${request.method} ${path}`);

    // Health check
    if (path === '/health') {
      console.log('  → Health check');
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

    // Home page
    if (path === '/') {
      console.log('  → Home page');
      return this.handleHomePage();
    }

    // Web UI for credentials and project configuration
    if (path === '/ui' || path.startsWith('/ui/')) {
      console.log('  → Web UI');
      return this.handleWebUI(request);
    }

    // API endpoints
    if (path.startsWith('/api/')) {
      console.log('  → API endpoint');
      return this.handleAPI(request);
    }

    // MCP endpoints
    const mcpMatch = path.match(/^\/([^/]+)\/mcp$/);
    if (mcpMatch) {
      const projectId = mcpMatch[1];
      console.log(`  → MCP endpoint for project: ${projectId}`);
      return this.handleMCP(request, projectId);
    }

    console.log('  → 404 Not Found');
    return new Response('Not Found', { status: 404 });
  }

  private async handleHomePage(): Promise<Response> {
    const htmlPath = join(process.cwd(), 'web-ui', 'home.html');
    const file = Bun.file(htmlPath);
    
    if (await file.exists()) {
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Home page not found', { status: 404 });
  }

  private async handleWebUI(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Route to different UI pages
    let htmlFileName = 'index.html';
    
    if (path.startsWith('/ui/project')) {
      htmlFileName = 'project.html';
    }
    
    // Serve the HTML file
    const htmlPath = join(process.cwd(), 'web-ui', htmlFileName);
    const file = Bun.file(htmlPath);
    
    if (await file.exists()) {
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Web UI not found', { status: 404 });
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

    return new Response('Not Found', { status: 404 });
  }

  private async handleGetProjects(): Promise<Response> {
    console.log(`  [API] Get all projects`);
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

      console.log(`    Found ${enrichedProjects.length} project(s)`);
      return new Response(
        JSON.stringify({ projects: enrichedProjects }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleGetProject(projectId: string): Promise<Response> {
    console.log(`  [API] Get project: ${projectId}`);
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
          })),
          tools: capabilities.tools.map(t => ({
            id: t.id,
            type: t.type,
          })),
          servers: capabilities.servers.map(s => ({
            id: s.id,
            type: s.type,
            description: s.def?.description || null,
            url: s.def?.url || null,
          })),
        } : null,
      };

      console.log(`    Project found`);
      return new Response(
        JSON.stringify(projectDetails),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleProjectConfigure(projectId: string, request: Request): Promise<Response> {
    try {
      console.log(`  [API] Configure project: ${projectId}`);
      const capabilities: Capabilities = await request.json();
      console.log(`    Skills: ${capabilities.skills.map(s => s.id).join(', ')}`);
      console.log(`    Tools: ${capabilities.tools.length}`);
      console.log(`    Servers: ${capabilities.servers.length}`);

      // Store capabilities
      this.sessionManager.setProjectCapabilities(projectId, capabilities);

      // Detect OAuth2 requirements for HTTP-based MCP servers
      console.log(`    Detecting OAuth2 requirements...`);
      const oauth2Servers: any[] = [];
      for (const server of capabilities.servers) {
        if (server.def.url) {
          console.log(`      Checking server: ${server.id}`);
          const oauth2Config = await this.oauth2Manager.detectOAuth2Requirement(server.def.url);
          if (oauth2Config) {
            console.log(`        ✓ OAuth2 required`);
            let isConnected = this.oauth2Manager.isServerConnected(projectId, server.id);
            
            // Validate existing connection by attempting to get a valid token
            // This will trigger token refresh if needed and delete invalid tokens
            if (isConnected) {
              const accessToken = await this.oauth2Manager.getAccessToken(projectId, server.id);
              isConnected = !!accessToken;
              if (!isConnected) {
                console.log(`        ⚠ OAuth2 token invalid/expired`);
              }
            }
            
            // Store OAuth2 config in server definition
            server.def.oauth2 = oauth2Config;
            oauth2Servers.push({
              serverId: server.id,
              serverUrl: server.def.url,
              displayName: server.id,
              isConnected: isConnected,
            });
          }
        }
      }

      // Update stored capabilities with OAuth2 configs
      if (oauth2Servers.length > 0) {
        this.sessionManager.setProjectCapabilities(projectId, capabilities);
      }

      // Extract all required variables
      const requiredVars = extractAllVariables(capabilities);
      console.log(`    Required variables: ${requiredVars.join(', ')}`);

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
      // Skip validation for OAuth2 servers that aren't connected yet
      console.log(`    Validating tools...`);
      let toolValidationResults: any[] = [];
      try {
        // Create a temporary MCP server instance for validation
        const mcpServer = this.mcpServers.get(projectId);
        if (mcpServer) {
          toolValidationResults = await mcpServer.validateTools(capabilities);
        } else {
          // Create temporary instance just for validation
          const project = this.db.getProject(projectId);
          if (project) {
            const tempMcpServer = new CapaMCPServer(
              this.db,
              this.sessionManager,
              this.subprocessManager,
              projectId,
              project.path
            );
            toolValidationResults = await tempMcpServer.validateTools(capabilities);
          }
        }
        
        // Filter out validation failures for OAuth2 servers that need connection
        const oauth2ServerIds = new Set(oauth2Servers.filter(s => !s.isConnected).map(s => s.serverId));
        const nonOAuth2ValidationResults = toolValidationResults.filter(r => !oauth2ServerIds.has(r.serverId));
        const oauth2PendingResults = toolValidationResults.filter(r => oauth2ServerIds.has(r.serverId));
        
        if (oauth2PendingResults.length > 0) {
          console.log(`    ℹ ${oauth2PendingResults.length} tool(s) skipped validation (OAuth2 authentication required)`);
          // Mark OAuth2 tools as pending authentication
          for (const pending of oauth2PendingResults) {
            pending.success = true; // Don't mark as failed
            pending.pendingAuth = true;
            pending.error = undefined;
          }
        }
        
        const failedTools = nonOAuth2ValidationResults.filter(r => !r.success);
        if (failedTools.length > 0) {
          console.log(`    ⚠ ${failedTools.length} tool(s) failed validation:`);
          for (const failed of failedTools) {
            console.log(`      - ${failed.toolId}: ${failed.error}`);
          }
        } else if (nonOAuth2ValidationResults.length > 0) {
          console.log(`    ✓ All ${nonOAuth2ValidationResults.length} non-OAuth2 tool(s) validated successfully`);
        }
      } catch (error: any) {
        console.error(`    ✗ Tool validation error: ${error.message}`);
        // Continue even if validation fails - this is informational
      }

      if (missingVars.length > 0 || needsOAuth2Connection) {
        console.log(`    ⚠ Missing variables: ${missingVars.join(', ')}`);
        if (needsOAuth2Connection) {
          console.log(`    ⚠ OAuth2 connections needed: ${oauth2Servers.filter(s => !s.isConnected).map(s => s.serverId).join(', ')}`);
        }
        const credentialsUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui?project=${projectId}`;
        
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

      console.log(`    ✓ Project configured successfully`);
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
      console.error(`    ✗ Error: ${error.message}`);
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
    console.log(`  [API] Get variables for project: ${projectId}`);
    const capabilities = this.sessionManager.getProjectCapabilities(projectId);
    if (!capabilities) {
      console.log(`    ✗ Project not configured`);
      return new Response(
        JSON.stringify({ error: 'Project not configured' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const requiredVars = extractAllVariables(capabilities);
    const values = this.db.getAllVariables(projectId);
    console.log(`    Required: ${requiredVars.length}, Set: ${Object.keys(values).length}`);

    return new Response(
      JSON.stringify({
        required: requiredVars,
        values,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  private async handleSetVariables(projectId: string, request: Request): Promise<Response> {
    try {
      console.log(`  [API] Set variables for project: ${projectId}`);
      const variables: Record<string, string> = await request.json();

      for (const [key, value] of Object.entries(variables)) {
        console.log(`    Setting: ${key} = ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}`);
        this.db.setVariable(projectId, key, value);
      }

      console.log(`    ✓ Set ${Object.keys(variables).length} variable(s)`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
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
    console.log(`  [API] Get OAuth2 servers for project: ${projectId}`);
    const capabilities = this.sessionManager.getProjectCapabilities(projectId);
    if (!capabilities) {
      return new Response(
        JSON.stringify({ error: 'Project not configured' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const oauth2Servers = capabilities.servers
      .filter((s: any) => s.def.oauth2)
      .map((s: any) => {
        const isConnected = this.oauth2Manager.isServerConnected(projectId, s.id);
        let expiresAt: number | undefined;
        
        if (isConnected) {
          const tokenData = this.db.getOAuthToken(projectId, s.id);
          expiresAt = tokenData?.expires_at;
        }
        
        return {
          serverId: s.id,
          serverUrl: s.def.url,
          displayName: s.id,
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

  private async handleOAuth2Start(projectId: string, request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const serverId = url.searchParams.get('server');
      
      if (!serverId) {
        return new Response(
          JSON.stringify({ error: 'Missing server parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      console.log(`  [API] Start OAuth2 flow for server: ${serverId}`);
      
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

      // Generate authorization URL
      const redirectUri = `http://${this.settings.server.host}:${this.settings.server.port}/api/projects/${projectId}/oauth/callback`;
      const { url: authUrl, state } = await this.oauth2Manager.generateAuthorizationUrl(
        projectId,
        serverId,
        server.def.oauth2,
        redirectUri
      );

      console.log(`    ✓ Authorization URL generated`);
      return new Response(
        JSON.stringify({ authorizationUrl: authUrl, state }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleOAuth2Callback(projectId: string, request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        console.log(`  [API] OAuth2 callback error: ${error}`);
        // Redirect to UI with error
        const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui?project=${projectId}&oauth_error=${encodeURIComponent(error)}`;
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

      console.log(`  [API] OAuth2 callback for project: ${projectId}`);
      
      const result = await this.oauth2Manager.handleCallback(code, state);
      
      if (!result.success) {
        console.error(`    ✗ Callback failed: ${result.error}`);
        const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui?project=${projectId}&oauth_error=${encodeURIComponent(result.error || 'Unknown error')}`;
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      console.log(`    ✓ OAuth2 flow completed for server: ${result.serverId}`);
      
      // Redirect back to UI with success
      const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui?project=${projectId}&oauth_success=true&server=${result.serverId}`;
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      const redirectUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui?project=${projectId}&oauth_error=${encodeURIComponent(error.message)}`;
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    }
  }

  private async handleOAuth2Disconnect(projectId: string, serverId: string): Promise<Response> {
    console.log(`  [API] Disconnect OAuth2 for server: ${serverId}`);
    try {
      this.oauth2Manager.disconnect(projectId, serverId);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleTokenRefreshStatus(): Promise<Response> {
    console.log(`  [API] Get token refresh scheduler status`);
    try {
      const status = this.tokenRefreshScheduler.getStatus();
      return new Response(
        JSON.stringify(status),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleForceTokenRefresh(): Promise<Response> {
    console.log(`  [API] Force token refresh check`);
    try {
      await this.tokenRefreshScheduler.forceCheck();
      return new Response(
        JSON.stringify({ success: true, message: 'Token refresh check completed' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error(`    ✗ Error: ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleMCP(request: Request, projectId: string): Promise<Response> {
    // Get or create MCP server for this project
    let mcpServer = this.mcpServers.get(projectId);
    
    if (!mcpServer) {
      console.log(`  [MCP] Creating new MCP server for project: ${projectId}`);
      // Get project from database
      const project = this.db.getProject(projectId);
      if (!project) {
        console.log(`    ✗ Project not found`);
        return new Response('Project not found', { status: 404 });
      }

      // Create MCP server
      mcpServer = new CapaMCPServer(
        this.db,
        this.sessionManager,
        this.subprocessManager,
        projectId,
        project.path
      );

      this.mcpServers.set(projectId, mcpServer);
      console.log(`    ✓ MCP server created`);
    }

    // Handle MCP protocol via HTTP (simplified without SSE)
    if (request.method === 'POST') {
      try {
        const message = await request.json();
        console.log(`  [MCP] ${message.method || 'notification'} (id: ${message.id || 'none'})`);
        
        // Handle JSON-RPC message
        const result = await mcpServer.handleMessage(message);
        
        // Return simple JSON response (not SSE)
        return new Response(
          JSON.stringify(result),
          {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          }
        );
      } catch (error: any) {
        console.error(`  [MCP] ✗ Error: ${error.message}`);
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
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }
    }

    // Handle OPTIONS for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
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
    console.log('Stopping CAPA server...');

    // Stop token refresh scheduler
    this.tokenRefreshScheduler.stop();

    // Close all MCP servers
    for (const [projectId, mcpServer] of this.mcpServers) {
      await mcpServer.close();
    }

    // Stop all subprocesses
    this.subprocessManager.stopAll();

    // Close database
    this.db.close();

    console.log('✓ CAPA server stopped');
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
  console.error('Failed to start server:', error);
  process.exit(1);
});
