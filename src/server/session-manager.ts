import { nanoid } from 'nanoid';
import type { CapaDatabase } from '../db/database';
import type { Capabilities, Tool } from '../types/capabilities';
import { getQualifiedToolName, normalizeToolName, normalizeToolReference } from '../types/capabilities';
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
  private capabilitiesLoadInflight = new Map<string, Promise<Capabilities | null>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private logger = logger.child('SessionManager');

  constructor(db: CapaDatabase) {
    this.db = db;
    this.startCleanupTimer();
  }

  /**
   * Stop background work (cleanup timer) and release references.
   *
   * Idempotent. Safe to call multiple times. Must be called by tests and by
   * the production graceful-shutdown path before closing the underlying
   * database; otherwise the cleanup interval will keep a strong reference to
   * `this` (and the closed DB) and fire after teardown.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
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
    const sessionInfo: SessionInfo = {
      sessionId: dbSession.session_id,
      projectId: dbSession.project_id,
      activeSkills: skillIds,
      availableTools: [...new Set(skillTools)],
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

    // Merge with previously active skills so tools from earlier setup_tools calls remain available
    const mergedSkills = [...new Set([...session.activeSkills, ...skillIds])];
    session.activeSkills = mergedSkills;
    const skillTools = this.getToolsForSkills(session.projectId, mergedSkills);
    session.availableTools = [...new Set(skillTools)];
    session.lastActivity = Date.now();

    this.logger.debug(`Available tools: ${session.availableTools.join(', ')}`);

    // Update database
    this.db.updateSessionSkills(sessionId, mergedSkills);

    return session.availableTools;
  }

  /**
   * Resolve a skill `requires` reference to a qualified tool name.
   * Tries matching by qualified name first, then falls back to matching by bare tool id.
   * This allows skills to reference grouped command tools by just their id (e.g. "commit")
   * even though the qualified name is "git.commit".
   */
  private resolveToolReference(ref: string, capabilities: Capabilities): string {
    const normalized = normalizeToolReference(ref);

    // Direct match against qualified names
    const directMatch = capabilities.tools.find(
      (t) => getQualifiedToolName(t) === normalized
    );
    if (directMatch) return normalized;

    // Fallback: match by bare tool id (for grouped command tools and MCP tools
    // referenced without their server/group prefix)
    const byId = capabilities.tools.find((t) => t.id === normalized);
    if (byId) return getQualifiedToolName(byId);

    // No match found — return the normalized reference as-is so the caller
    // can still surface it (it will simply fail to resolve to a tool later)
    return normalized;
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
        for (const ref of skill.def.requires) {
          requiredTools.add(this.resolveToolReference(ref, capabilities));
        }
      }
    }

    return Array.from(requiredTools);
  }

  /**
   * Get all tools required by any skill in a project.
   * Used for 'expose-all' mode to show all available tools upfront.
   * Plugin tools must be declared by the user in `tools:` and referenced from
   * a skill's `requires` to be exposed — they are not auto-included.
   */
  getAllRequiredToolsForProject(projectId: string): string[] {
    const capabilities = this.getProjectCapabilities(projectId);
    if (!capabilities) {
      return [];
    }

    const requiredTools = new Set<string>();

    // Iterate through all skills and collect their required tools (resolved to qualified names)
    for (const skill of capabilities.skills) {
      if (skill.def && skill.def.requires) {
        for (const ref of skill.def.requires) {
          requiredTools.add(this.resolveToolReference(ref, capabilities));
        }
      }
    }

    return Array.from(requiredTools);
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

    const existing = this.capabilitiesLoadInflight.get(projectId);
    if (existing) {
      const result = Bun.peek(existing);
      if (!(result instanceof Promise)) {
        return result;
      }
    }

    const promise = Promise.resolve(this.loadCapabilitiesFromDb(projectId)).finally(
      () => this.capabilitiesLoadInflight.delete(projectId)
    );
    this.capabilitiesLoadInflight.set(projectId, promise);
    return this.projectCapabilities.get(projectId) ?? null;
  }

  private loadCapabilitiesFromDb(projectId: string): Capabilities | null {
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
    return new Map(this.projectCapabilities);
  }

  /**
   * Get tool definition by qualified name.
   * Tries an exact match first, then falls back to normalized comparison
   * (dots ↔ underscores) to handle MCP clients that replace dots in tool names.
   */
  getToolDefinition(projectId: string, qualifiedName: string): Tool | null {
    const capabilities = this.getProjectCapabilities(projectId);
    if (!capabilities) {
      return null;
    }

    const exact = capabilities.tools.find((t) => getQualifiedToolName(t) === qualifiedName);
    if (exact) return exact;

    const normalized = normalizeToolName(qualifiedName);
    return capabilities.tools.find(
      (t) => normalizeToolName(getQualifiedToolName(t)) === normalized
    ) || null;
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
    const timer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Run every minute
    // Don't keep the event loop alive solely for this cleanup task. This is a
    // no-op on platforms/runtimes that don't support `unref` on timers.
    (timer as { unref?: () => void }).unref?.();
    this.cleanupTimer = timer;
  }

  private cleanupExpiredSessions(): void {
    if (this.disposed) return;
    const timeout = 60; // 60 minutes
    try {
      this.db.deleteExpiredSessions(timeout);
    } catch (error) {
      // The database may have been closed between scheduling and the timer
      // firing (e.g. during shutdown or in tests). Swallow the error rather
      // than crash the process with an unhandled rejection.
      this.logger.debug(`Skipping session cleanup: ${(error as Error).message}`);
      return;
    }

    // Clean up in-memory sessions
    const cutoff = Date.now() - timeout * 60 * 1000;
    for (const [sessionId, session] of this.sessions) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
