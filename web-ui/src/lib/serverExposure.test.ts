import { describe, expect, it } from 'bun:test';
import type { Server, Tool } from '../types/api';
import {
  addingToolCuratesServer,
  authoredTools,
  computeServerExposure,
  effectiveToolExposure,
  skillRequiresApplies,
} from './serverExposure';

const server = (id: string, expose?: Server['expose']): Server =>
  ({ id, type: 'mcp', expose: expose ?? null }) as Server;

const mcp = (server: string, tool: string, fromServerExpose = false): Tool => ({
  id: `${server}-${tool}`,
  type: 'mcp',
  sourcePlugin: null,
  mcpServer: `@${server}`,
  mcpTool: tool,
  fromServerExpose,
});

describe('computeServerExposure', () => {
  it('uses synthesized tools for policy servers (omitted expose = all)', () => {
    const exposure = computeServerExposure(
      [server('github'), server('slack', 'except')],
      [mcp('github', 'search', true), mcp('github', 'create_issue', true), mcp('slack', 'read', true)],
    );
    expect(exposure.github.mode).toBe('all');
    expect([...exposure.github.exposedToolNames].sort()).toEqual(['create_issue', 'search']);
    expect(exposure.slack.mode).toBe('except');
    expect([...exposure.slack.exposedToolNames]).toEqual(['read']);
  });

  it('treats a server with authored tool entries as curated', () => {
    const exposure = computeServerExposure(
      [server('github', 'all')],
      [mcp('github', 'search')],
    );
    expect(exposure.github.mode).toBe('curated');
    expect([...exposure.github.exposedToolNames]).toEqual(['search']);
  });

  it('exposes nothing for expose: none', () => {
    const exposure = computeServerExposure([server('github', 'none')], []);
    expect(exposure.github).toEqual({ mode: 'none', exposedToolNames: new Set() });
  });
});

describe('helpers', () => {
  it('authoredTools drops synthesized tools', () => {
    expect(authoredTools([mcp('a', 'x'), mcp('a', 'y', true)]).map((t) => t.mcpTool)).toEqual(['x']);
  });

  it('warns before curating only for servers exposing through a policy', () => {
    expect(addingToolCuratesServer({ mode: 'all', exposedToolNames: new Set() })).toBe(true);
    expect(addingToolCuratesServer({ mode: 'curated', exposedToolNames: new Set() })).toBe(false);
    expect(addingToolCuratesServer({ mode: 'none', exposedToolNames: new Set() })).toBe(false);
    expect(addingToolCuratesServer(undefined)).toBe(false);
  });

  it('requires only applies outside search mode; omitted mode is expose-all', () => {
    expect(skillRequiresApplies('search')).toBe(false);
    expect(skillRequiresApplies('on-demand')).toBe(true);
    expect(skillRequiresApplies(null)).toBe(true);
    expect(effectiveToolExposure(undefined)).toBe('expose-all');
  });
});
