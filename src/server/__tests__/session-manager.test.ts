import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { SessionManager } from '../session-manager';
import type { Capabilities } from '../../types/capabilities';

describe('SessionManager', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let sessionManager: SessionManager;

  const capabilities: Capabilities = {
    providers: ['cursor'],
    skills: [],
    tools: [],
    servers: [],
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-session-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    db.upsertProject({ id: 'test-proj', path: '/test/path' });
    sessionManager = new SessionManager(db);
    sessionManager.setProjectCapabilities('test-proj', capabilities);
  });

  afterEach(() => {
    sessionManager.dispose();
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('should return a copy of project capabilities map', () => {
    const returned = sessionManager.getAllProjectCapabilities();

    expect(returned.get('test-proj')).toEqual(capabilities);
    returned.set('mutated', { providers: [], skills: [], tools: [], servers: [] });

    expect(sessionManager.getAllProjectCapabilities().has('mutated')).toBe(false);
    expect(sessionManager.getAllProjectCapabilities().get('test-proj')).toEqual(capabilities);
  });

  describe('server-exposed tools', () => {
    // What `expandServerExposedTools` hands the session manager: tools marked
    // as coming from a server's `expose` policy, with no skill requiring them.
    const exposed: Capabilities = {
      providers: ['cursor'],
      skills: [{ id: 'unrelated', type: 'inline', def: { content: 'x' } }],
      servers: [
        { id: 'github', type: 'mcp', expose: 'all', def: { url: 'https://x.test/mcp' } },
      ],
      tools: [
        {
          id: 'search',
          type: 'mcp',
          fromServerExpose: true,
          def: { server: '@github', tool: 'search' },
        },
        {
          id: 'create_issue',
          type: 'mcp',
          fromServerExpose: true,
          def: { server: '@github', tool: 'create_issue' },
        },
      ],
    } as Capabilities;

    beforeEach(() => {
      sessionManager.setProjectCapabilities('test-proj', exposed);
    });

    it('exposes them without any skill requiring them', () => {
      expect(sessionManager.getAllRequiredToolsForProject('test-proj').sort()).toEqual([
        'github.create_issue',
        'github.search',
      ]);
    });

    it('activates a whole server through setup_tools', () => {
      const session = sessionManager.createSession('test-proj');
      const tools = sessionManager.setupTools(session.sessionId, ['@github']);
      expect(tools.sort()).toEqual(['github.create_issue', 'github.search']);
    });

    it('survives a capabilities refresh that only carries the authored file', () => {
      // The UI poll and the OAuth sync both re-read capabilities.yaml, which
      // has no synthesized tools in it — those must not disappear.
      const authoredOnly = { ...exposed, tools: [] } as Capabilities;
      sessionManager.setProjectCapabilities('test-proj', authoredOnly);

      expect(
        sessionManager.getProjectCapabilities('test-proj')?.tools.map((t) => t.id).sort(),
      ).toEqual(['create_issue', 'search']);
    });

    it('drops cached policy tools a narrowed policy no longer allows on refresh', () => {
      const refresh = (patch: Partial<Capabilities>) =>
        sessionManager.setProjectCapabilities('test-proj', {
          ...exposed,
          tools: [],
          ...patch,
        } as Capabilities);
      const toolIds = () =>
        sessionManager.getProjectCapabilities('test-proj')?.tools.map((t) => t.id).sort();

      // all -> exactly [search]: create_issue must disappear before any reconfigure.
      refresh({
        servers: [
          { id: 'github', type: 'mcp', expose: 'exactly', tools: ['search'], def: { url: 'https://x.test/mcp' } },
        ],
      } as Partial<Capabilities>);
      expect(toolIds()).toEqual(['search']);

      // A later refresh with a wider policy can't resurrect what was dropped.
      refresh({});
      expect(toolIds()).toEqual(['search']);

      // none -> nothing.
      refresh({
        servers: [{ id: 'github', type: 'mcp', expose: 'none', def: { url: 'https://x.test/mcp' } }],
      } as Partial<Capabilities>);
      expect(toolIds()).toEqual([]);
    });

    it('drops cached policy tools when the server becomes curated or is removed', () => {
      sessionManager.setProjectCapabilities('test-proj', {
        ...exposed,
        tools: [{ id: 'pick', type: 'mcp', def: { server: '@github', tool: 'search' } }],
      } as Capabilities);
      expect(
        sessionManager.getProjectCapabilities('test-proj')?.tools.map((t) => t.id),
      ).toEqual(['pick']);

      sessionManager.setProjectCapabilities('test-proj', exposed);
      sessionManager.setProjectCapabilities('test-proj', { ...exposed, servers: [], tools: [] } as Capabilities);
      expect(sessionManager.getProjectCapabilities('test-proj')?.tools).toEqual([]);
    });

    it('filters synthesized tools recovered from the database by the stored policies', () => {
      // A merged record persisted before the policy was narrowed to exactly [search].
      db.setProjectCapabilities(
        'test-proj',
        JSON.stringify({
          ...exposed,
          servers: [
            { id: 'github', type: 'mcp', expose: 'exactly', tools: ['search'], def: { url: 'https://x.test/mcp' } },
          ],
        }),
      );
      const restarted = new SessionManager(db);
      try {
        expect(
          restarted.getProjectCapabilities('test-proj')?.tools.map((t) => t.id).sort(),
        ).toEqual(['search']);
      } finally {
        restarted.dispose();
      }
    });

    it('clears policy tools when the policy is gone', () => {
      sessionManager.setExposedTools('test-proj', []);
      expect(sessionManager.getProjectCapabilities('test-proj')?.tools).toEqual([]);
    });

    it('activates only what a sub-agent allow-list names', () => {
      const session = sessionManager.createSession('test-proj');
      const tools = sessionManager.setupTools(
        session.sessionId,
        ['@github'],
        new Set(['github.search']),
      );
      expect(tools).toEqual(['github.search']);
    });

    it('activates a whole server whose expose is omitted (defaults to all)', () => {
      const defaults = {
        ...exposed,
        servers: [{ id: 'github', type: 'mcp', def: { url: 'https://x.test/mcp' } }],
      } as Capabilities;
      sessionManager.setProjectCapabilities('test-proj', defaults);
      const session = sessionManager.createSession('test-proj');
      const tools = sessionManager.setupTools(session.sessionId, ['@github']);
      expect(tools.sort()).toEqual(['github.create_issue', 'github.search']);
    });

    it('rejects @server when the server tools are declared by hand (policy off)', () => {
      const curated = {
        ...exposed,
        servers: [{ id: 'github', type: 'mcp', def: { url: 'https://x.test/mcp' } }],
        tools: [{ id: 'search', type: 'mcp', def: { server: '@github', tool: 'search' } }],
      } as Capabilities;
      sessionManager.setExposedTools('test-proj', []);
      sessionManager.setProjectCapabilities('test-proj', curated);
      const session = sessionManager.createSession('test-proj');
      expect(() => sessionManager.setupTools(session.sessionId, ['@github'])).toThrow(
        /Skill not found: @github/,
      );
    });

    it('still rejects an unknown skill id', () => {
      const session = sessionManager.createSession('test-proj');
      expect(() => sessionManager.setupTools(session.sessionId, ['nope'])).toThrow(
        /Skill not found: nope/,
      );
    });
  });
});
