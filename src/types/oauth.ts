// OAuth2 type definitions for MCP authorization

export interface OAuth2Config {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  resourceServer: string;
  registrationEndpoint?: string;
  scope?: string;
  /** Client ID when provided by plugin/MCP config (e.g. Slack app client_id) */
  client_id?: string;
  /** Callback port from plugin .mcp.json (Claude-style): use http://127.0.0.1:port/callback as redirect_uri */
  callback_port?: number;
}

export interface OAuth2Token {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_at?: number;
  scope?: string;
}

export interface OAuth2FlowState {
  state: string;
  project_id: string;
  server_id: string;
  code_verifier: string;
  redirect_uri: string;
}

export interface OAuth2ServerInfo {
  serverId: string;
  serverUrl: string;
  displayName: string;
  isConnected: boolean;
  oauth2Config?: OAuth2Config;
}

export interface OAuth2Metadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
}
