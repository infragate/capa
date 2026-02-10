// OAuth2 Manager for MCP servers
// Implements OAuth 2.1 with PKCE following the MCP Authorization specification
// https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

import type { CapaDatabase } from '../db/database';
import type {
  OAuth2Config,
  OAuth2Token,
  OAuth2Metadata,
  ProtectedResourceMetadata,
} from '../types/oauth';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../utils/pkce';

export class OAuth2Manager {
  private db: CapaDatabase;
  private oauth2ConfigCache = new Map<string, OAuth2Config>();
  private capabilitiesProvider?: () => Map<string, any>;

  constructor(db: CapaDatabase) {
    this.db = db;
  }

  /**
   * Set the capabilities provider function (called from server initialization)
   */
  setCapabilitiesProvider(provider: () => Map<string, any>): void {
    this.capabilitiesProvider = provider;
  }

  /**
   * Detect if an MCP server requires OAuth2 authentication
   * Per MCP spec: Make unauthenticated request, check for 401 + WWW-Authenticate header
   */
  async detectOAuth2Requirement(serverUrl: string): Promise<OAuth2Config | null> {
    try {
      console.log(`      [OAuth2] Detecting OAuth2 requirement for: ${serverUrl}`);
      
      // Make unauthenticated request to MCP server
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'capa-oauth-detection', version: '1.0.0' },
          },
        }),
      });

      // Check for 401 Unauthorized
      if (response.status !== 401) {
        console.log(`        No OAuth2 required (status: ${response.status})`);
        return null;
      }

      // Parse WWW-Authenticate header
      const wwwAuthenticate = response.headers.get('WWW-Authenticate');
      if (!wwwAuthenticate) {
        console.log(`        401 but no WWW-Authenticate header`);
        return null;
      }

      console.log(`        WWW-Authenticate: ${wwwAuthenticate}`);

      // Extract resource metadata URL from WWW-Authenticate header
      // Format: Bearer resource_metadata="https://..."
      let resourceMetadataUrl: string | null = null;
      const resourceMetadataMatch = wwwAuthenticate.match(/resource_metadata="([^"]+)"/);
      
      if (resourceMetadataMatch) {
        resourceMetadataUrl = resourceMetadataMatch[1];
        console.log(`        Resource metadata URL: ${resourceMetadataUrl}`);
      } else {
        // Try constructing the well-known URL from the server URL
        console.log(`        No resource_metadata in WWW-Authenticate, trying standard location`);
        try {
          const serverUrlObj = new URL(serverUrl);
          const baseUrl = `${serverUrlObj.protocol}//${serverUrlObj.host}`;
          resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
          console.log(`        Trying: ${resourceMetadataUrl}`);
        } catch (error) {
          console.log(`        Could not construct well-known URL`);
          return null;
        }
      }

      // First, try direct OAuth discovery (many servers like Atlassian use this)
      const serverUrlObj = new URL(serverUrl);
      const baseUrl = `${serverUrlObj.protocol}//${serverUrlObj.host}`;
      console.log(`        Trying direct OAuth discovery at: ${baseUrl}`);
      
      let authMetadata = await this.fetchAuthServerMetadata(baseUrl);
      
      // If direct discovery failed, try protected resource metadata (RFC 9728)
      if (!authMetadata) {
        console.log(`        Direct discovery failed, trying RFC 9728...`);
        const resourceMetadata = await this.fetchProtectedResourceMetadata(resourceMetadataUrl);
        
        if (resourceMetadata && resourceMetadata.authorization_servers && resourceMetadata.authorization_servers.length > 0) {
          // Use first authorization server
          const authServerUrl = resourceMetadata.authorization_servers[0];
          console.log(`        Authorization server: ${authServerUrl}`);

          // Fetch authorization server metadata
          authMetadata = await this.fetchAuthServerMetadata(authServerUrl);
        }
      }
      
      if (!authMetadata) {
        console.log(`        Failed to fetch auth server metadata`);
        return null;
      }

      const config: OAuth2Config = {
        authorizationEndpoint: authMetadata.authorization_endpoint,
        tokenEndpoint: authMetadata.token_endpoint,
        resourceServer: serverUrl,
        registrationEndpoint: authMetadata.registration_endpoint,
        scope: authMetadata.scopes_supported?.join(' '),
      };

      console.log(`        ✓ OAuth2 detected`);
      this.oauth2ConfigCache.set(serverUrl, config);
      return config;
    } catch (error: any) {
      console.error(`        ✗ Error detecting OAuth2: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch protected resource metadata (RFC 9728)
   * Default path: /.well-known/oauth-protected-resource
   */
  private async fetchProtectedResourceMetadata(url: string): Promise<ProtectedResourceMetadata | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch authorization server metadata (RFC 8414)
   * Path: /.well-known/oauth-authorization-server
   */
  private async fetchAuthServerMetadata(authServerUrl: string): Promise<OAuth2Metadata | null> {
    try {
      // Construct well-known URL
      const wellKnownUrl = new URL('/.well-known/oauth-authorization-server', authServerUrl).toString();
      
      console.log(`        Fetching OAuth metadata from: ${wellKnownUrl}`);
      const response = await fetch(wellKnownUrl);
      if (!response.ok) {
        console.log(`        OAuth metadata fetch failed: ${response.status}`);
        return null;
      }
      const metadata = await response.json();
      console.log(`        ✓ OAuth metadata fetched`);
      console.log(`          Authorization: ${metadata.authorization_endpoint}`);
      console.log(`          Token: ${metadata.token_endpoint}`);
      return metadata;
    } catch (error: any) {
      console.log(`        OAuth metadata fetch error: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate authorization URL for OAuth2 flow with PKCE
   */
  async generateAuthorizationUrl(
    projectId: string,
    serverId: string,
    oauth2Config: OAuth2Config,
    redirectUri: string
  ): Promise<{ url: string; state: string }> {
    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Try dynamic client registration if supported
    let clientId = 'capa'; // Default fallback
    if (oauth2Config.registrationEndpoint) {
      try {
        console.log(`      [OAuth2] Attempting dynamic client registration...`);
        const registeredClient = await this.registerClient(oauth2Config.registrationEndpoint, redirectUri);
        if (registeredClient && registeredClient.client_id) {
          clientId = registeredClient.client_id;
          console.log(`        ✓ Registered client: ${clientId}`);
          
          // Store client credentials if provided
          if (registeredClient.client_secret) {
            // Store in database for token exchange
            this.db.setVariable(projectId, `oauth2_client_secret_${serverId}`, registeredClient.client_secret);
          }
        }
      } catch (error: any) {
        console.log(`        ⚠ Dynamic registration failed: ${error.message}`);
        console.log(`        Using default client_id`);
      }
    }

    // Store flow state in database (including client_id for token exchange)
    this.db.storeFlowState(state, projectId, serverId, codeVerifier, redirectUri, clientId);

    // Clean up expired flow states (older than 10 minutes)
    this.db.deleteExpiredFlowStates(10);

    // Build authorization URL per OAuth 2.1 with PKCE
    const authUrl = new URL(oauth2Config.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    // Include resource parameter per RFC 8707 (Resource Indicators) - but only if server might support it
    // Some servers (like Atlassian) don't support this parameter and may error
    // Only include if the OAuth metadata explicitly advertises support
    // For now, comment this out as it causes issues with Atlassian
    // authUrl.searchParams.set('resource', oauth2Config.resourceServer);
    
    if (oauth2Config.scope) {
      authUrl.searchParams.set('scope', oauth2Config.scope);
    }

    console.log(`      [OAuth2] Generated authorization URL for ${serverId}`);
    return { url: authUrl.toString(), state };
  }

  /**
   * Register a dynamic OAuth client (RFC 7591)
   */
  private async registerClient(registrationEndpoint: string, redirectUri: string): Promise<any> {
    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'CAPA - Capabilities Package Manager',
        client_uri: 'https://github.com/infragate/capa',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client (PKCE protects it)
        application_type: 'native',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Registration failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Handle OAuth2 callback - exchange authorization code for tokens
   */
  async handleCallback(code: string, state: string): Promise<{
    success: boolean;
    projectId?: string;
    serverId?: string;
    error?: string;
  }> {
    try {
      // Retrieve flow state
      const flowState = this.db.getFlowState(state);
      if (!flowState) {
        return { success: false, error: 'Invalid or expired state parameter' };
      }

      // Parse flow state (it might be JSON or just the code_verifier for backwards compatibility)
      let code_verifier: string;
      let redirect_uri: string;
      let client_id: string = 'capa';
      
      try {
        const stateData = JSON.parse(flowState.code_verifier);
        code_verifier = stateData.code_verifier;
        redirect_uri = stateData.redirect_uri || flowState.redirect_uri;
        client_id = stateData.client_id || 'capa';
      } catch {
        // Old format - just the code_verifier string
        code_verifier = flowState.code_verifier;
        redirect_uri = flowState.redirect_uri;
      }

      const { project_id, server_id } = flowState;

      // Delete flow state (one-time use)
      this.db.deleteFlowState(state);

      // Get OAuth2 config from cache
      const capabilities = await this.getProjectCapabilities(project_id);
      if (!capabilities) {
        return { success: false, error: 'Project capabilities not found' };
      }

      const server = capabilities.servers.find((s: any) => s.id === server_id);
      if (!server || !server.def.oauth2) {
        return { success: false, error: 'Server OAuth2 config not found' };
      }

      const oauth2Config = server.def.oauth2;

      // Get client credentials if stored (from dynamic registration)
      const clientSecret = this.db.getVariable(project_id, `oauth2_client_secret_${server_id}`);

      console.log(`      [OAuth2] Exchanging code for tokens`);
      console.log(`        client_id: ${client_id}`);
      console.log(`        token_endpoint: ${oauth2Config.tokenEndpoint}`);

      // Exchange authorization code for tokens
      const tokenParams: Record<string, string> = {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri,
        client_id: client_id,
        code_verifier: code_verifier,
      };

      if (clientSecret) {
        tokenParams.client_secret = clientSecret;
      }

      const tokenResponse = await fetch(oauth2Config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(tokenParams).toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`Token exchange failed: ${errorText}`);
        return { success: false, error: 'Failed to exchange authorization code for tokens' };
      }

      const tokenData = await tokenResponse.json();

      // Calculate token expiration
      const expiresAt = tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : undefined;

      // Store tokens in database
      this.db.setOAuthToken(project_id, server_id, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_at: expiresAt,
        scope: tokenData.scope,
      });

      console.log(`      [OAuth2] ✓ Tokens stored for ${server_id}`);
      return { success: true, projectId: project_id, serverId: server_id };
    } catch (error: any) {
      console.error(`      [OAuth2] ✗ Callback error: ${error.message}`);
      return { success: false, error: error.message || 'Token exchange failed' };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(projectId: string, serverId: string, oauth2Config: OAuth2Config): Promise<boolean> {
    try {
      const tokenData = this.db.getOAuthToken(projectId, serverId);
      if (!tokenData || !tokenData.refresh_token) {
        console.error(`      [OAuth2] No refresh token available for ${serverId}`);
        return false;
      }

      console.log(`      [OAuth2] Refreshing access token for ${serverId}`);

      const response = await fetch(oauth2Config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          client_id: 'capa', // TODO: Support dynamic client registration
        }).toString(),
      });

      if (!response.ok) {
        console.error(`      [OAuth2] Token refresh failed: ${response.statusText}`);
        return false;
      }

      const newTokenData = await response.json();

      // Calculate token expiration
      const expiresAt = newTokenData.expires_in
        ? Date.now() + newTokenData.expires_in * 1000
        : undefined;

      // Update tokens in database
      this.db.setOAuthToken(projectId, serverId, {
        access_token: newTokenData.access_token,
        refresh_token: newTokenData.refresh_token || tokenData.refresh_token,
        token_type: newTokenData.token_type || 'Bearer',
        expires_at: expiresAt,
        scope: newTokenData.scope || tokenData.scope,
      });

      console.log(`      [OAuth2] ✓ Access token refreshed for ${serverId}`);
      return true;
    } catch (error: any) {
      console.error(`      [OAuth2] ✗ Token refresh error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get access token for a server (with automatic refresh if expired)
   */
  async getAccessToken(projectId: string, serverId: string, oauth2Config: OAuth2Config): Promise<string | null> {
    const tokenData = this.db.getOAuthToken(projectId, serverId);
    if (!tokenData) {
      return null;
    }

    // Check if token is expired or will expire soon (within 5 minutes)
    if (tokenData.expires_at) {
      const expiresIn = tokenData.expires_at - Date.now();
      if (expiresIn < 5 * 60 * 1000) {
        console.log(`      [OAuth2] Token expired or expiring soon, refreshing...`);
        const refreshed = await this.refreshAccessToken(projectId, serverId, oauth2Config);
        if (!refreshed) {
          return null;
        }
        // Get updated token
        const updatedToken = this.db.getOAuthToken(projectId, serverId);
        return updatedToken?.access_token || null;
      }
    }

    return tokenData.access_token;
  }

  /**
   * Check if a server has valid OAuth2 credentials
   */
  isServerConnected(projectId: string, serverId: string): boolean {
    const tokenData = this.db.getOAuthToken(projectId, serverId);
    return !!tokenData;
  }

  /**
   * Disconnect OAuth2 connection (delete tokens)
   */
  disconnect(projectId: string, serverId: string): void {
    this.db.deleteOAuthToken(projectId, serverId);
    console.log(`      [OAuth2] Disconnected ${serverId}`);
  }

  /**
   * Helper to get project capabilities
   */
  private async getProjectCapabilities(projectId: string): Promise<any> {
    if (!this.capabilitiesProvider) {
      return null;
    }
    const capabilities = this.capabilitiesProvider();
    return capabilities.get(projectId) || null;
  }
}
