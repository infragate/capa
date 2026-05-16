import { describe, it, expect } from 'bun:test';
import type { Capabilities } from '../../../types/capabilities';

/**
 * Pure-function port of `validatePluginSkillReferences` from install.ts. The
 * production function logs via `console.warn`; this mirror returns the warnings
 * so we can assert against them without coupling to logging internals.
 */
function collectPluginSkillWarnings(capabilities: Capabilities): string[] {
  const warnings: string[] = [];
  const pluginSkills = capabilities.skills.filter((s) => s.type === 'plugin');
  if (pluginSkills.length === 0) return warnings;

  const exposedSkillIds = new Set<string>();
  for (const plugin of capabilities.resolvedPlugins ?? []) {
    for (const id of plugin.skills ?? []) {
      exposedSkillIds.add(id);
    }
  }

  for (const skill of pluginSkills) {
    if (!skill.sourcePlugin && !exposedSkillIds.has(skill.id)) {
      warnings.push(skill.id);
    }
  }

  return warnings;
}

function collectOrphanPluginServers(capabilities: Capabilities): Record<string, string[]> {
  const referencedServerIds = new Set<string>();
  for (const tool of capabilities.tools) {
    if (tool.type !== 'mcp') continue;
    const mcpDef = tool.def as { server?: string };
    if (mcpDef.server) referencedServerIds.add(mcpDef.server.replace(/^@/, ''));
  }

  const orphans: Record<string, string[]> = {};
  for (const plugin of capabilities.resolvedPlugins ?? []) {
    const o = (plugin.serverIds ?? []).filter((id) => !referencedServerIds.has(id));
    if (o.length > 0) orphans[plugin.id] = o;
  }
  return orphans;
}

describe('plugin skill validation', () => {
  it('does not warn when a plugin skill id matches a resolved plugin manifest skill', () => {
    const caps: Capabilities = {
      skills: [
        { id: 'slack-messaging', type: 'plugin', def: { requires: ['@slack.send_message'] } },
      ],
      servers: [],
      tools: [],
      resolvedPlugins: [
        {
          id: 'slack-mcp',
          name: 'Slack',
          provider: 'claude',
          repository: 'https://github.com/slackapi/slack-mcp-plugin',
          skills: ['slack-messaging'],
          serverIds: ['slack'],
        },
      ],
    };
    expect(collectPluginSkillWarnings(caps)).toEqual([]);
  });

  it('warns when a plugin skill id is not exposed by any plugin', () => {
    const caps: Capabilities = {
      skills: [
        { id: 'ghost-skill', type: 'plugin', def: { requires: ['@slack.send_message'] } },
      ],
      servers: [],
      tools: [],
      resolvedPlugins: [
        {
          id: 'slack-mcp',
          name: 'Slack',
          provider: 'claude',
          repository: 'https://github.com/slackapi/slack-mcp-plugin',
          skills: ['slack-messaging'],
          serverIds: ['slack'],
        },
      ],
    };
    expect(collectPluginSkillWarnings(caps)).toEqual(['ghost-skill']);
  });

  it('suppresses the warning when the plugin entry was attached via sourcePlugin', () => {
    const caps: Capabilities = {
      skills: [
        {
          id: 'slack-messaging',
          type: 'plugin',
          def: { requires: ['@slack.send_message'] },
          sourcePlugin: { id: 'slack-mcp', name: 'Slack', provider: 'claude' },
        },
      ],
      servers: [],
      tools: [],
      resolvedPlugins: [],
    };
    expect(collectPluginSkillWarnings(caps)).toEqual([]);
  });

  it('returns no warnings when no plugin skills are declared', () => {
    const caps: Capabilities = {
      skills: [{ id: 'local', type: 'inline', def: { content: '# Local' } }],
      servers: [],
      tools: [],
    };
    expect(collectPluginSkillWarnings(caps)).toEqual([]);
  });
});

describe('orphan plugin server detection', () => {
  it('flags plugin servers that no user-declared tool references', () => {
    const caps: Capabilities = {
      skills: [],
      servers: [
        { id: 'slack', type: 'mcp', def: { cmd: 'node x.js' } },
      ],
      tools: [],
      resolvedPlugins: [
        {
          id: 'slack-mcp', name: 'Slack', provider: 'claude',
          repository: 'https://example', skills: [], serverIds: ['slack'],
        },
      ],
    };
    expect(collectOrphanPluginServers(caps)).toEqual({ 'slack-mcp': ['slack'] });
  });

  it('does not flag plugin servers that have at least one referencing tool', () => {
    const caps: Capabilities = {
      skills: [],
      servers: [
        { id: 'slack', type: 'mcp', def: { cmd: 'node x.js' } },
      ],
      tools: [
        { id: 'send_message', type: 'mcp', def: { server: '@slack', tool: 'slack_post_message' } },
      ],
      resolvedPlugins: [
        {
          id: 'slack-mcp', name: 'Slack', provider: 'claude',
          repository: 'https://example', skills: [], serverIds: ['slack'],
        },
      ],
    };
    expect(collectOrphanPluginServers(caps)).toEqual({});
  });

  it('handles multiple plugins independently', () => {
    const caps: Capabilities = {
      skills: [],
      servers: [
        { id: 'slack', type: 'mcp', def: { cmd: 'node a.js' } },
        { id: 'databricks', type: 'mcp', def: { cmd: 'node b.js' } },
      ],
      tools: [
        { id: 'send_message', type: 'mcp', def: { server: '@slack', tool: 'slack_post_message' } },
      ],
      resolvedPlugins: [
        {
          id: 'slack-mcp', name: 'Slack', provider: 'claude',
          repository: 'https://example', skills: [], serverIds: ['slack'],
        },
        {
          id: 'databricks', name: 'Databricks', provider: 'claude',
          repository: 'https://example', skills: [], serverIds: ['databricks'],
        },
      ],
    };
    expect(collectOrphanPluginServers(caps)).toEqual({ databricks: ['databricks'] });
  });
});
