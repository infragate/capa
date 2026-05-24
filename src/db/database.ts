import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type {
  Project,
  ToolInitState,
  MCPSubprocess,
  Session,
  GitIntegration,
  OAuthTokenRow,
  OAuthFlowStateRow,
  RegistryRecord,
  RegistryStatus,
} from '../types/database';
import { initSchema } from './schema';
import { ProjectsRepo } from './projects';
import { SessionsRepo } from './sessions';
import { VariablesRepo } from './variables';
import { ManagedFilesRepo } from './managed-files';
import { type ManagedHookRow, ManagedHooksRepo } from './managed-hooks';
import { OAuthTokensRepo } from './oauth-tokens';
import { OAuthFlowStateRepo } from './oauth-flow-state';
import { GitIntegrationsRepo } from './git-integrations';
import { ToolInitStateRepo } from './tool-init-state';
import { SubAgentsRepo } from './sub-agents';
import { MCPSubprocessesRepo } from './mcp-subprocesses';
import { RegistriesRepo, type RegistryUpsertInput } from './registries';

export class CapaDatabase {
  private db: Database;
  private projects: ProjectsRepo;
  private sessions: SessionsRepo;
  private variables: VariablesRepo;
  private managedFiles: ManagedFilesRepo;
  private managedHooks: ManagedHooksRepo;
  private oauthTokens: OAuthTokensRepo;
  private oauthFlowState: OAuthFlowStateRepo;
  private gitIntegrations: GitIntegrationsRepo;
  private toolInitState: ToolInitStateRepo;
  private subAgents: SubAgentsRepo;
  private mcpSubprocesses: MCPSubprocessesRepo;
  private registries: RegistriesRepo;

  constructor(dbPath: string) {
    // Ensure parent directory exists before creating database
    const dbDir = dirname(dbPath);
    mkdirSync(dbDir, { recursive: true });

    this.db = new Database(dbPath, { create: true });
    initSchema(this.db);

    this.projects = new ProjectsRepo(this.db);
    this.sessions = new SessionsRepo(this.db);
    this.variables = new VariablesRepo(this.db);
    this.managedFiles = new ManagedFilesRepo(this.db);
    this.managedHooks = new ManagedHooksRepo(this.db);
    this.oauthTokens = new OAuthTokensRepo(this.db);
    this.oauthFlowState = new OAuthFlowStateRepo(this.db);
    this.gitIntegrations = new GitIntegrationsRepo(this.db);
    this.toolInitState = new ToolInitStateRepo(this.db);
    this.subAgents = new SubAgentsRepo(this.db);
    this.mcpSubprocesses = new MCPSubprocessesRepo(this.db);
    this.registries = new RegistriesRepo(this.db);
  }

  // Project operations
  upsertProject(project: Omit<Project, 'created_at' | 'updated_at'>): void {
    return this.projects.upsert(project);
  }

  getProject(id: string): Project | null {
    return this.projects.get(id);
  }

  getProjectByPath(path: string): Project | null {
    return this.projects.getByPath(path);
  }

  getAllProjects(): Project[] {
    return this.projects.getAll();
  }

  deleteProject(projectId: string): void {
    return this.projects.delete(projectId);
  }

  // Project provider operations
  setProjectProviders(projectId: string, providers: string[]): void {
    return this.projects.setProviders(projectId, providers);
  }

  getProjectProviders(projectId: string): string[] {
    return this.projects.getProviders(projectId);
  }

  // Sub-agent operations
  upsertSubAgent(projectId: string, agentId: string): void {
    return this.subAgents.upsert(projectId, agentId);
  }

  getSubAgents(projectId: string): Array<{ agent_id: string }> {
    return this.subAgents.getAll(projectId);
  }

  removeSubAgent(projectId: string, agentId: string): void {
    return this.subAgents.remove(projectId, agentId);
  }

  setProjectCapabilities(projectId: string, capabilitiesJson: string): void {
    return this.projects.setCapabilities(projectId, capabilitiesJson);
  }

  getProjectCapabilities(projectId: string): string | null {
    return this.projects.getCapabilities(projectId);
  }

  // Variable operations
  setVariable(projectId: string, key: string, value: string): void {
    return this.variables.set(projectId, key, value);
  }

  getVariable(projectId: string, key: string): string | null {
    return this.variables.get(projectId, key);
  }

  getAllVariables(projectId: string): Record<string, string> {
    return this.variables.getAll(projectId);
  }

  deleteVariable(projectId: string, key: string): void {
    return this.variables.delete(projectId, key);
  }

  // Managed files operations
  addManagedFile(projectId: string, filePath: string): void {
    return this.managedFiles.add(projectId, filePath);
  }

  getManagedFiles(projectId: string): string[] {
    return this.managedFiles.getAll(projectId);
  }

  removeManagedFile(projectId: string, filePath: string): void {
    return this.managedFiles.remove(projectId, filePath);
  }

  clearManagedFiles(projectId: string): void {
    return this.managedFiles.clear(projectId);
  }

  // Managed hooks operations
  upsertManagedHook(input: Omit<ManagedHookRow, 'createdAt'>): void {
    return this.managedHooks.upsert(input);
  }

  getManagedHooks(projectId: string): ManagedHookRow[] {
    return this.managedHooks.getAll(projectId);
  }

  removeManagedHook(projectId: string, providerId: string, hookId: string): void {
    return this.managedHooks.remove(projectId, providerId, hookId);
  }

  clearManagedHooks(projectId: string): void {
    return this.managedHooks.clear(projectId);
  }

  // Tool init state operations
  setToolInitialized(projectId: string, toolId: string, error: string | null = null): void {
    return this.toolInitState.setInitialized(projectId, toolId, error);
  }

  getToolInitState(projectId: string, toolId: string): ToolInitState | null {
    return this.toolInitState.get(projectId, toolId);
  }

  // MCP subprocess operations
  upsertMCPSubprocess(subprocess: Omit<MCPSubprocess, 'started_at' | 'last_health_check'> & Partial<Pick<MCPSubprocess, 'started_at' | 'last_health_check'>>): void {
    return this.mcpSubprocesses.upsert(subprocess);
  }

  getMCPSubprocess(id: string): MCPSubprocess | null {
    return this.mcpSubprocesses.get(id);
  }

  getMCPSubprocessByHash(hash: string): MCPSubprocess | null {
    return this.mcpSubprocesses.getByHash(hash);
  }

  getAllMCPSubprocesses(): MCPSubprocess[] {
    return this.mcpSubprocesses.getAll();
  }

  deleteMCPSubprocess(id: string): void {
    return this.mcpSubprocesses.delete(id);
  }

  // Session operations
  createSession(sessionId: string, projectId: string): void {
    return this.sessions.create(sessionId, projectId);
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId);
  }

  updateSessionActivity(sessionId: string): void {
    return this.sessions.updateActivity(sessionId);
  }

  updateSessionSkills(sessionId: string, skillIds: string[]): void {
    return this.sessions.updateSkills(sessionId, skillIds);
  }

  deleteSession(sessionId: string): void {
    return this.sessions.delete(sessionId);
  }

  deleteExpiredSessions(timeoutMinutes: number): void {
    return this.sessions.deleteExpired(timeoutMinutes);
  }

  // OAuth2 token operations
  getOAuthToken(projectId: string, serverId: string): OAuthTokenRow | null {
    return this.oauthTokens.get(projectId, serverId);
  }

  setOAuthToken(projectId: string, serverId: string, tokenData: {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_at?: number;
    scope?: string;
  }): void {
    return this.oauthTokens.set(projectId, serverId, tokenData);
  }

  deleteOAuthToken(projectId: string, serverId: string): void {
    return this.oauthTokens.delete(projectId, serverId);
  }

  getAllOAuthTokens(projectId: string): OAuthTokenRow[] {
    return this.oauthTokens.getAll(projectId);
  }

  // OAuth2 flow state operations
  storeFlowState(state: string, projectId: string, serverId: string, codeVerifier: string, redirectUri: string, clientId?: string): void {
    return this.oauthFlowState.store(state, projectId, serverId, codeVerifier, redirectUri, clientId);
  }

  getFlowState(state: string): OAuthFlowStateRow | null {
    return this.oauthFlowState.get(state);
  }

  deleteFlowState(state: string): void {
    return this.oauthFlowState.delete(state);
  }

  deleteExpiredFlowStates(timeoutMinutes: number = 10): void {
    return this.oauthFlowState.deleteExpired(timeoutMinutes);
  }

  // Git integration operations
  getGitIntegration(platform: string, host: string | null = null): GitIntegration | null {
    return this.gitIntegrations.get(platform, host);
  }

  setGitIntegration(
    platform: 'github' | 'gitlab' | 'github-enterprise' | 'gitlab-self-managed',
    tokenData: {
      host?: string | null;
      access_token: string;
      refresh_token?: string | null;
      token_type?: string;
      expires_at?: number | null;
    }
  ): void {
    return this.gitIntegrations.set(platform, tokenData);
  }

  deleteGitIntegration(platform: string, host: string | null = null): void {
    return this.gitIntegrations.delete(platform, host);
  }

  getAllGitIntegrations(): GitIntegration[] {
    return this.gitIntegrations.getAll();
  }

  // Convenience methods for CLI git client (uses provider string format like "github.com" or "gitlab.com")
  getGitOAuthToken(provider: string): GitIntegration | null {
    return this.gitIntegrations.getOAuthToken(provider);
  }

  setGitOAuthToken(
    provider: string,
    tokenData: {
      access_token: string;
      refresh_token?: string | null;
      token_type?: string;
      expires_at?: number | null;
    }
  ): void {
    return this.gitIntegrations.setOAuthToken(provider, tokenData);
  }

  getAllGitOAuthTokens(): Array<GitIntegration & { provider: string }> {
    return this.gitIntegrations.getAllOAuthTokens();
  }

  // Registry operations
  listRegistries(): RegistryRecord[] {
    return this.registries.list();
  }

  getRegistry(slug: string): RegistryRecord | null {
    return this.registries.get(slug);
  }

  upsertRegistry(input: RegistryUpsertInput): RegistryRecord {
    return this.registries.upsert(input);
  }

  setRegistryStatus(slug: string, status: RegistryStatus, lastError: string | null = null): void {
    return this.registries.setStatus(slug, status, lastError);
  }

  setRegistryEnabled(slug: string, enabled: boolean): void {
    return this.registries.setEnabled(slug, enabled);
  }

  deleteRegistry(slug: string): void {
    return this.registries.delete(slug);
  }

  // Generic kv-style flags persisted in the `meta` table.
  getMeta(key: string): string | null {
    const row = this.db
      .query('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  close(): void {
    this.db.close();
  }
}
