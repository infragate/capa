import { describe, it, expect } from 'bun:test';
import { getQualifiedToolName } from '../../types/capabilities';
import type { Tool, Capabilities, SubAgent } from '../../types/capabilities';

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeMCPTool = (id: string, serverId: string): Tool => ({
  id,
  type: 'mcp',
  def: { server: `@${serverId}`, tool: id },
});

const makeCommandTool = (id: string, group?: string): Tool => ({
  id,
  type: 'command',
  group,
  def: { run: { cmd: `echo ${id}` } },
});

// Mirrors the private getAgentAllowedToolIds logic so we can unit-test it
// independently without instantiating the full MCP server stack.
function getAllowedToolIds(
  agentId: string,
  capabilities: Capabilities
): Set<string> | null {
  if (!capabilities.subAgents) return null;
  const subAgent = capabilities.subAgents.find((a) => a.id === agentId);
  if (!subAgent) return null;
  const allowed = new Set<string>();
  for (const toolId of subAgent.tools) {
    const tool = capabilities.tools.find((t) => t.id === toolId);
    if (tool) allowed.add(getQualifiedToolName(tool));
  }
  return allowed;
}

// ─── capabilities fixture ─────────────────────────────────────────────────────

const capabilities: Capabilities = {
  providers: ['claude-code'],
  skills: [],
  servers: [],
  tools: [
    makeMCPTool('search_cdk_docs', 'aws-iac'),
    makeMCPTool('validate_cfn', 'aws-iac'),
    makeMCPTool('get_lambda_guidance', 'aws-serverless'),
    makeMCPTool('sam_logs', 'aws-serverless'),
    makeCommandTool('deploy', 'git'),
  ],
  subAgents: [
    {
      id: 'infra-agent',
      description: 'IaC specialist',
      skills: ['infragate-iac'],
      tools: ['search_cdk_docs', 'validate_cfn'],
    },
    {
      id: 'api-agent',
      description: 'Lambda specialist',
      skills: ['infragate-serverless'],
      tools: ['get_lambda_guidance', 'sam_logs'],
    },
    {
      id: 'empty-agent',
      description: 'No tools',
      skills: [],
      tools: [],
    },
  ],
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe('getQualifiedToolName', () => {
  it('qualifies MCP tools as serverId.toolId', () => {
    expect(getQualifiedToolName(makeMCPTool('search_cdk_docs', 'aws-iac'))).toBe(
      'aws-iac.search_cdk_docs'
    );
  });

  it('qualifies command tools with group as group.toolId', () => {
    expect(getQualifiedToolName(makeCommandTool('deploy', 'git'))).toBe('git.deploy');
  });

  it('returns plain id for ungrouped command tools', () => {
    expect(getQualifiedToolName(makeCommandTool('run'))).toBe('run');
  });
});

describe('sub-agent tool filtering logic', () => {
  it('returns null for unknown agent id', () => {
    expect(getAllowedToolIds('ghost-agent', capabilities)).toBeNull();
  });

  it('returns null when subAgents is absent', () => {
    const cap: Capabilities = { ...capabilities, subAgents: undefined };
    expect(getAllowedToolIds('infra-agent', cap)).toBeNull();
  });

  it('infra-agent only sees its two tools', () => {
    const allowed = getAllowedToolIds('infra-agent', capabilities)!;
    expect(allowed.size).toBe(2);
    expect(allowed.has('aws-iac.search_cdk_docs')).toBe(true);
    expect(allowed.has('aws-iac.validate_cfn')).toBe(true);
    expect(allowed.has('aws-serverless.get_lambda_guidance')).toBe(false);
    expect(allowed.has('aws-serverless.sam_logs')).toBe(false);
  });

  it('api-agent only sees its two tools', () => {
    const allowed = getAllowedToolIds('api-agent', capabilities)!;
    expect(allowed.size).toBe(2);
    expect(allowed.has('aws-serverless.get_lambda_guidance')).toBe(true);
    expect(allowed.has('aws-serverless.sam_logs')).toBe(true);
    expect(allowed.has('aws-iac.search_cdk_docs')).toBe(false);
  });

  it('empty-agent returns an empty set (not null)', () => {
    const allowed = getAllowedToolIds('empty-agent', capabilities)!;
    expect(allowed).not.toBeNull();
    expect(allowed.size).toBe(0);
  });

  it('tool id not in main tools list is silently skipped', () => {
    const cap: Capabilities = {
      ...capabilities,
      subAgents: [
        {
          id: 'broken-agent',
          description: '',
          skills: [],
          tools: ['search_cdk_docs', 'nonexistent_tool'],
        },
      ],
    };
    const allowed = getAllowedToolIds('broken-agent', cap)!;
    expect(allowed.size).toBe(1);
    expect(allowed.has('aws-iac.search_cdk_docs')).toBe(true);
  });

  it('allowed-set filtering correctly includes/excludes from a full list', () => {
    const allTools = capabilities.tools.map(getQualifiedToolName);
    const allowed = getAllowedToolIds('infra-agent', capabilities)!;

    const visible = allTools.filter((name) => allowed.has(name));
    const hidden = allTools.filter((name) => !allowed.has(name));

    expect(visible.sort()).toEqual(['aws-iac.search_cdk_docs', 'aws-iac.validate_cfn']);
    expect(hidden).toContain('aws-serverless.get_lambda_guidance');
    expect(hidden).toContain('aws-serverless.sam_logs');
  });
});
