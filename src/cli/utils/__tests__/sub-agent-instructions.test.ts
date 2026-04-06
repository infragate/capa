import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installSubAgentInstructions, removeSubAgentInstructions } from '../agents-file';
import type { SubAgent, Capabilities, Tool } from '../../../types/capabilities';

// Minimal capabilities fixture with two tools
const makeTool = (id: string, serverId: string): Tool => ({
  id,
  type: 'mcp',
  def: { server: `@${serverId}`, tool: id },
});

const capabilities: Capabilities = {
  providers: ['claude-code'],
  skills: [],
  servers: [],
  tools: [
    makeTool('search_cdk_docs', 'aws-iac'),
    makeTool('validate_cfn', 'aws-iac'),
    makeTool('get_lambda_guidance', 'aws-serverless'),
    makeTool('sam_logs', 'aws-serverless'),
  ],
};

describe('installSubAgentInstructions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-subagent-instr-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  const readClaude = () => readFileSync(join(tempDir, 'CLAUDE.md'), 'utf-8');
  const readClaudeAgent = (id: string) =>
    readFileSync(join(tempDir, '.claude', 'agents', `${id}.md`), 'utf-8');
  const readCursorAgent = (id: string) =>
    readFileSync(join(tempDir, '.cursor', 'agents', `${id}.md`), 'utf-8');

  it('creates .claude/agents/{id}.md and CLAUDE.md for claude-code provider', () => {
    const subAgent: SubAgent = {
      id: 'infra-agent',
      description: 'CDK and Terraform specialist',
      skills: ['infragate-iac'],
      tools: ['search_cdk_docs', 'validate_cfn'],
    };

    installSubAgentInstructions(tempDir, subAgent, capabilities, ['claude-code']);

    expect(existsSync(join(tempDir, '.claude', 'agents', 'infra-agent.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(true);

    const agentFile = readClaudeAgent('infra-agent');
    expect(agentFile).toContain('name: infra-agent');
    expect(agentFile).toContain('description: CDK and Terraform specialist');
    expect(agentFile).toContain('model: inherit');
    expect(agentFile).toContain('capa-infra-agent');
  });

  it('includes qualified tool names in .claude/agents/{id}.md', () => {
    const subAgent: SubAgent = {
      id: 'infra-agent',
      description: '',
      skills: [],
      tools: ['search_cdk_docs', 'validate_cfn'],
    };

    installSubAgentInstructions(tempDir, subAgent, capabilities, ['claude-code']);

    const agentFile = readClaudeAgent('infra-agent');
    expect(agentFile).toContain('aws-iac.search_cdk_docs');
    expect(agentFile).toContain('aws-iac.validate_cfn');
    expect(agentFile).not.toContain('aws-serverless');
  });

  it('includes custom instructions in the agent file body', () => {
    const subAgent: SubAgent = {
      id: 'infra-agent',
      description: '',
      skills: [],
      tools: ['search_cdk_docs'],
      instructions: 'Work only in backend-infra/ and user-infra/.',
    };

    installSubAgentInstructions(tempDir, subAgent, capabilities, ['claude-code']);

    expect(readClaudeAgent('infra-agent')).toContain('Work only in backend-infra/ and user-infra/.');
  });

  it('upserts CLAUDE.md block — re-running replaces without duplicating', () => {
    const subAgent: SubAgent = {
      id: 'infra-agent',
      description: 'v1',
      skills: [],
      tools: ['search_cdk_docs'],
    };

    installSubAgentInstructions(tempDir, subAgent, capabilities, ['claude-code']);
    installSubAgentInstructions(
      tempDir,
      { ...subAgent, description: 'v2 updated' },
      capabilities,
      ['claude-code']
    );

    const content = readClaude();
    const startCount = (content.match(/<!-- capa:start:sub-agent:infra-agent -->/g) || []).length;
    expect(startCount).toBe(1);
    expect(content).toContain('v2 updated');
    expect(content).not.toContain('v1');
  });

  it('multiple sub-agents produce independent .claude/agents/ files', () => {
    installSubAgentInstructions(
      tempDir,
      { id: 'infra-agent', description: '', skills: [], tools: ['search_cdk_docs'] },
      capabilities,
      ['claude-code']
    );
    installSubAgentInstructions(
      tempDir,
      { id: 'api-agent', description: '', skills: [], tools: ['sam_logs'] },
      capabilities,
      ['claude-code']
    );

    expect(existsSync(join(tempDir, '.claude', 'agents', 'infra-agent.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.claude', 'agents', 'api-agent.md'))).toBe(true);
    expect(readClaudeAgent('infra-agent')).toContain('aws-iac.search_cdk_docs');
    expect(readClaudeAgent('api-agent')).toContain('aws-serverless.sam_logs');
  });

  it('writes .cursor/agents/{id}.md for cursor provider (not CLAUDE.md)', () => {
    const subAgent: SubAgent = {
      id: 'infra-agent',
      description: 'CDK specialist',
      skills: [],
      tools: ['search_cdk_docs'],
    };

    installSubAgentInstructions(tempDir, subAgent, capabilities, ['cursor']);

    expect(existsSync(join(tempDir, '.cursor', 'agents', 'infra-agent.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(tempDir, '.claude', 'agents', 'infra-agent.md'))).toBe(false);

    const content = readCursorAgent('infra-agent');
    expect(content).toContain('name: infra-agent');
    expect(content).toContain('description: CDK specialist');
    expect(content).toContain('model: inherit');
    expect(content).toContain('readonly: false');
    expect(content).toContain('is_background: false');
    expect(content).toContain('aws-iac.search_cdk_docs');
  });

  it('writes both .claude/agents/ and .cursor/agents/ when both providers active', () => {
    const subAgent: SubAgent = {
      id: 'infra-agent',
      description: 'Infra specialist',
      skills: [],
      tools: ['search_cdk_docs'],
    };

    installSubAgentInstructions(tempDir, subAgent, capabilities, ['claude-code', 'cursor']);

    expect(existsSync(join(tempDir, '.claude', 'agents', 'infra-agent.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.cursor', 'agents', 'infra-agent.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(true);
  });
});

describe('removeSubAgentInstructions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-subagent-remove-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes .claude/agents/{id}.md and CLAUDE.md block for claude-code', () => {
    const subAgent: SubAgent = { id: 'infra-agent', description: '', skills: [], tools: [] };
    installSubAgentInstructions(tempDir, subAgent, capabilities, ['claude-code']);
    removeSubAgentInstructions(tempDir, 'infra-agent', ['claude-code']);

    expect(existsSync(join(tempDir, '.claude', 'agents', 'infra-agent.md'))).toBe(false);
    const content = readFileSync(join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).not.toContain('capa:start:sub-agent:infra-agent');
  });

  it('leaves other sub-agent files intact', () => {
    installSubAgentInstructions(
      tempDir,
      { id: 'infra-agent', description: 'infra', skills: [], tools: [] },
      capabilities,
      ['claude-code']
    );
    installSubAgentInstructions(
      tempDir,
      { id: 'api-agent', description: 'api', skills: [], tools: [] },
      capabilities,
      ['claude-code']
    );

    removeSubAgentInstructions(tempDir, 'infra-agent', ['claude-code']);

    expect(existsSync(join(tempDir, '.claude', 'agents', 'infra-agent.md'))).toBe(false);
    expect(existsSync(join(tempDir, '.claude', 'agents', 'api-agent.md'))).toBe(true);
  });

  it('removes .cursor/agents/{id}.md for cursor', () => {
    const subAgent: SubAgent = { id: 'infra-agent', description: '', skills: [], tools: [] };
    installSubAgentInstructions(tempDir, subAgent, capabilities, ['cursor']);
    removeSubAgentInstructions(tempDir, 'infra-agent', ['cursor']);

    expect(existsSync(join(tempDir, '.cursor', 'agents', 'infra-agent.md'))).toBe(false);
  });

  it('is a no-op when file does not exist', () => {
    removeSubAgentInstructions(tempDir, 'ghost-agent', ['claude-code']);
    removeSubAgentInstructions(tempDir, 'ghost-agent', ['cursor']);
  });
});
