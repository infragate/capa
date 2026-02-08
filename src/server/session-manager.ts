import { nanoid } from 'nanoid';
import type { CapaDatabase } from '../db/database';
import type { Capabilities, Tool } from '../types/capabilities';

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

    console.log(`      [SessionManager] Creating session: ${sessionId} for project: ${projectId}`);

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

    const sessionInfo: SessionInfo = {
      sessionId: dbSession.session_id,
      projectId: dbSession.project_id,
      activeSkills: JSON.parse(dbSession.skill_ids),
      availableTools: this.getToolsForSkills(
        dbSession.project_id,
        JSON.parse(dbSession.skill_ids)
      ),
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
    console.log(`      [SessionManager] Setting up tools for session: ${sessionId}`);
    console.log(`        Skills to activate: ${skillIds.join(', ')}`);
    
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get capabilities for this project
    const capabilities = this.projectCapabilities.get(session.projectId);
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

    // Update active skills
    session.activeSkills = skillIds;
    session.availableTools = this.getToolsForSkills(session.projectId, skillIds);
    session.lastActivity = Date.now();

    console.log(`        Available tools: ${session.availableTools.join(', ')}`);

    // Update database
    this.db.updateSessionSkills(sessionId, skillIds);

    return session.availableTools;
  }

  /**
   * Get tools required by skills
   */
  private getToolsForSkills(projectId: string, skillIds: string[]): string[] {
    const capabilities = this.projectCapabilities.get(projectId);
    if (!capabilities) {
      return [];
    }

    const requiredTools = new Set<string>();

    for (const skillId of skillIds) {
      const skill = capabilities.skills.find((s) => s.id === skillId);
      if (skill) {
        for (const toolId of skill.def.requires) {
          requiredTools.add(toolId);
        }
      }
    }

    return Array.from(requiredTools);
  }

  /**
   * Register capabilities for a project
   */
  setProjectCapabilities(projectId: string, capabilities: Capabilities): void {
    console.log(`      [SessionManager] Setting capabilities for project: ${projectId}`);
    console.log(`        Skills: ${capabilities.skills.length}`);
    console.log(`        Tools: ${capabilities.tools.length}`);
    console.log(`        Servers: ${capabilities.servers.length}`);
    this.projectCapabilities.set(projectId, capabilities);
  }

  /**
   * Get capabilities for a project
   */
  getProjectCapabilities(projectId: string): Capabilities | null {
    return this.projectCapabilities.get(projectId) || null;
  }

  /**
   * Get tool definition
   */
  getToolDefinition(projectId: string, toolId: string): Tool | null {
    const capabilities = this.projectCapabilities.get(projectId);
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
