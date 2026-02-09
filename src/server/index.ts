import { writeFileSync } from 'fs';
import { join } from 'path';
import { Server as HttpServer } from 'http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadSettings, getDatabasePath, getPidFilePath, ensureCapaDir } from '../shared/config';
import { CapaDatabase } from '../db/database';
import { SessionManager } from './session-manager';
import { SubprocessManager } from './subprocess-manager';
import { CapaMCPServer } from './mcp-handler';
import type { Capabilities } from '../types/capabilities';
import { extractAllVariables } from '../shared/variable-resolver';
import { VERSION } from '../version';

class CapaServer {
  private db!: CapaDatabase;
  private sessionManager!: SessionManager;
  private subprocessManager!: SubprocessManager;
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

    // Web UI for credentials
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

  private async handleWebUI(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Serve the HTML file
    const htmlPath = join(process.cwd(), 'web-ui', 'index.html');
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

    return new Response('Not Found', { status: 404 });
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

      if (missingVars.length > 0) {
        console.log(`    ⚠ Missing variables: ${missingVars.join(', ')}`);
        const credentialsUrl = `http://${this.settings.server.host}:${this.settings.server.port}/ui?project=${projectId}`;
        
        return new Response(
          JSON.stringify({
            success: false,
            needsCredentials: true,
            missingVariables: missingVars,
            credentialsUrl,
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
