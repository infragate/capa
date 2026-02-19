import { nanoid } from 'nanoid';
import type { CapaDatabase } from '../db/database';
import type { Capabilities, Tool } from '../types/capabilities';
import { logger } from '../shared/logger';

export interface SessionInfo {
  sessionId: string;
  projectId: string;
  activeSkills: string[];
  availableTools: string[];
  createdAt: number;
  lastActivity: number;
}

export class SessionManager {
  private db: CapaDatabase;
  private sessions = new Map<string, SessionInfo>();
  private projectCapabilities = new Map<string, Capabilities>();
  private logger = logger.child('SessionManager');

  constructor(db: CapaDatabase) {
    this.db = db;
    this.startCleanupTimer();
  }

  /**
   * Create a new session
   */
  createSession(projectId: string): SessionInfo {
    const sessionId = nanoid();
    const now = Date.now();

    this.logger.info(`Creating session: ${sessionId} for project: ${projectId}`);

    const session: SessionInfo = {
      sessionId,
      projectId,
      activeSkills: [],
      availableTools: [],
      createdAt: now,
      lastActivity: now,
    };

    this.sessions.set(sessionId, session);
    this.db.createSession(sessionId, projectId);

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      return session;
    }

    // Try to load from database
    const dbSession = this.db.getSession(sessionId);
    if (!dbSession) {
      return null;
    }

    const skillIds = JSON.parse(dbSession.skill_ids);
    const skillTools = this.getToolsForSkills(dbSession.project_id, skillIds);
    const pluginToolIds = this.getPluginToolIds(dbSession.project_id);
    const sessionInfo: SessionInfo = {
      sessionId: dbSession.session_id,
      projectId: dbSession.project_id,
      activeSkills: skillIds,
      availableTools: [...new Set([...skillTools, ...pluginToolIds])],
      createdAt: dbSession.created_at,
      lastActivity: dbSession.last_activity,
    };

    this.sessions.set(sessionId, sessionInfo);
    return sessionInfo;
  }

  /**
   * Update session activity
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      this.db.updateSessionActivity(sessionId);
    }
  }

  /**
   * Setup tools for a session (activate skills)
   */
  setupTools(sessionId: string, skillIds: string[]): string[] {
    this.logger.info(`Setting up tools for session: ${sessionId}`);
    this.logger.debug(`Skills to activate: ${skillIds.join(', ')}`);
    
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get capabilities for this project
    const capabilities = this.getProjectCapabilities(session.projectId);
    if (!capabilities) {
      throw new Error(`No capabilities configured for project: ${session.projectId}`);
    }

    // Validate skills exist
    for (const skillId of skillIds) {
      const skill = capabilities.skills.find((s) => s.id === skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${skillId}`);
      }
    }

    // Update active skills; available tools = skill-required tools + all plugin MCP tools
    session.activeSkills = skillIds;
    const skillTools = this.getToolsForSkills(session.projectId, skillIds);
    const pluginToolIds = this.getPluginToolIds(session.projectId);
    session.availableTools = [...new Set([...skillTools, ...pluginToolIds])];
    session.lastActivity = Date.now();

    this.logger.debug(`Available tools: ${session.availableTools.join(', ')}`);

    // Update database
    this.db.updateSessionSkills(sessionId, skillIds);

    return session.availableTools;
  }

  /**
   * Get tools required by skills
   */
  private getToolsForSkills(projectId: string, skillIds: string[]): string[] {
    const capabilities = this.getProjectCapabilities(projectId);
    if (!capabilities) {
      return [];
    }

    const requiredTools = new Set<string>();

    for (const skillId of skillIds) {
      const skill = capabilities.skills.find((s) => s.id === skillId);
      if (skill && skill.def && skill.def.requires) {
        for (const toolId of skill.def.requires) {
          requiredTools.add(toolId);
        }
      }
    }

    return Array.from(requiredTools);
  }

  /**
   * Get all tools required by any skill in a project, plus all plugin MCP tool ids.
   * Used for 'expose-all' mode to show all available tools upfront.
   */
  getAllRequiredToolsForProject(projectId: string): string[] {
    const capabilities = this.getProjectCapabilities(projectId);
    if (!capabilities) {
      return [];
    }

    const requiredTools = new Set<string>();

    // Iterate through all skills and collect their required tools
    for (const skill of capabilities.skills) {
      if (skill.def && skill.def.requires) {
        for (const toolId of skill.def.requires) {
          requiredTools.add(toolId);
        }
      }
    }

    // Include all tools from plugin MCP servers (plugins don't declare which tools skills use)
    for (const id of this.getPluginToolIds(projectId)) {
      requiredTools.add(id);
    }

    return Array.from(requiredTools);
  }

  /**
   * Get tool ids for all tools that came from plugins (sourcePlugin set).
   */
  getPluginToolIds(projectId: string): string[] {
    const capabilities = this.getProjectCapabilities(projectId);
    if (!capabilities) return [];
    return capabilities.tools.filter((t) => t.sourcePlugin).map((t) => t.id);
  }

  /**
   * Register capabilities for a project
   */
  setProjectCapabilities(projectId: string, capabilities: Capabilities): void {
    this.logger.info(`Setting capabilities for project: ${projectId}`);
    this.logger.debug(`Skills: ${capabilities.skills.length}, Tools: ${capabilities.tools.length}, Servers: ${capabilities.servers.length}`);
    this.projectCapabilities.set(projectId, capabilities);
    this.db.setProjectCapabilities(projectId, JSON.stringify(capabilities));
  }

  /**
   * Get capabilities for a project (loads from DB on cache miss, e.g. after server restart)
   */
  getProjectCapabilities(projectId: string): Capabilities | null {
    const cached = this.projectCapabilities.get(projectId);
    if (cached) {
      return cached;
    }
    const raw = this.db.getProjectCapabilities(projectId);
    if (!raw) {
      return null;
    }
    const capabilities = JSON.parse(raw) as Capabilities;
    this.projectCapabilities.set(projectId, capabilities);
    return capabilities;
  }

  /**
   * Get all project capabilities (for OAuth2Manager integration)
   */
  getAllProjectCapabilities(): Map<string, Capabilities> {
    return this.projectCapabilities;
  }

  /**
   * Get tool definition
   */
  getToolDefinition(projectId: string, toolId: string): Tool | null {
    const capabilities = this.getProjectCapabilities(projectId);
    if (!capabilities) {
      return null;
    }

    return capabilities.tools.find((t) => t.id === toolId) || null;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.db.deleteSession(sessionId);
  }

  /**
   * Clean up expired sessions
   */
  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Run every minute
  }

  private cleanupExpiredSessions(): void {
    const timeout = 60; // 60 minutes
    this.db.deleteExpiredSessions(timeout);

    // Clean up in-memory sessions
    const cutoff = Date.now() - timeout * 60 * 1000;
    for (const [sessionId, session] of this.sessions) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
