import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import TOML from '@iarna/toml';

import { getProvider, getAllProviders, getAllProviderIds, getIntegratedProviders } from '../index';
import { getMcpConfigPath, buildMcpEntry, buildSubAgentFile } from '../handlers';
import type { ProviderIntegration } from '../../../types/providers';

describe('Provider registry', () => {
  describe('getProvider', () => {
    it('returns a provider for known ids', () => {
      expect(getProvider('cursor')).toBeDefined();
      expect(getProvider('claude-code')).toBeDefined();
      expect(getProvider('codex')).toBeDefined();
    });

    it('returns undefined for unknown ids', () => {
      expect(getProvider('nonexistent')).toBeUndefined();
    });

    it('is case-insensitive', () => {
      expect(getProvider('CURSOR')?.id).toBe('cursor');
      expect(getProvider('Claude-Code')?.id).toBe('claude-code');
    });
  });

  describe('getAllProviders', () => {
    it('returns all entries from the ported skills registry', () => {
      const all = getAllProviders();
      expect(all.length).toBe(39);
    });

    it('every entry has the required base fields', () => {
      for (const p of getAllProviders()) {
        expect(p.id).toBeString();
        expect(p.displayName).toBeString();
        expect(p.skillsDir).toBeString();
      }
    });
  });

  describe('getIntegratedProviders', () => {
    it('returns providers with MCP integration', () => {
      const integrated = getIntegratedProviders();
      const ids = integrated.map((p) => p.id);
      expect(ids).toContain('cursor');
      expect(ids).toContain('claude-code');
      expect(ids).toContain('codex');
      expect(ids).toContain('github-copilot');
      expect(ids).toContain('opencode');
      expect(ids).toContain('roo');
    });
  });

  describe('skills-package parity: skillsDir and displayName match verbatim', () => {
    const expected: Record<string, { displayName: string; skillsDir: string }> = {
      amp: { displayName: 'Amp', skillsDir: '.agents/skills' },
      antigravity: { displayName: 'Antigravity', skillsDir: '.agent/skills' },
      augment: { displayName: 'Augment', skillsDir: '.augment/skills' },
      'claude-code': { displayName: 'Claude Code', skillsDir: '.claude/skills' },
      openclaw: { displayName: 'OpenClaw', skillsDir: 'skills' },
      cline: { displayName: 'Cline', skillsDir: '.cline/skills' },
      codebuddy: { displayName: 'CodeBuddy', skillsDir: '.codebuddy/skills' },
      codex: { displayName: 'Codex', skillsDir: '.agents/skills' },
      'command-code': { displayName: 'Command Code', skillsDir: '.commandcode/skills' },
      continue: { displayName: 'Continue', skillsDir: '.continue/skills' },
      crush: { displayName: 'Crush', skillsDir: '.crush/skills' },
      cursor: { displayName: 'Cursor', skillsDir: '.cursor/skills' },
      droid: { displayName: 'Droid', skillsDir: '.factory/skills' },
      'gemini-cli': { displayName: 'Gemini CLI', skillsDir: '.agents/skills' },
      'github-copilot': { displayName: 'GitHub Copilot', skillsDir: '.agents/skills' },
      goose: { displayName: 'Goose', skillsDir: '.goose/skills' },
      junie: { displayName: 'Junie', skillsDir: '.junie/skills' },
      'iflow-cli': { displayName: 'iFlow CLI', skillsDir: '.iflow/skills' },
      kilo: { displayName: 'Kilo Code', skillsDir: '.kilocode/skills' },
      'kimi-cli': { displayName: 'Kimi Code CLI', skillsDir: '.agents/skills' },
      'kiro-cli': { displayName: 'Kiro CLI', skillsDir: '.kiro/skills' },
      kode: { displayName: 'Kode', skillsDir: '.kode/skills' },
      mcpjam: { displayName: 'MCPJam', skillsDir: '.mcpjam/skills' },
      'mistral-vibe': { displayName: 'Mistral Vibe', skillsDir: '.vibe/skills' },
      mux: { displayName: 'Mux', skillsDir: '.mux/skills' },
      opencode: { displayName: 'OpenCode', skillsDir: '.agents/skills' },
      openhands: { displayName: 'OpenHands', skillsDir: '.openhands/skills' },
      pi: { displayName: 'Pi', skillsDir: '.pi/skills' },
      qoder: { displayName: 'Qoder', skillsDir: '.qoder/skills' },
      'qwen-code': { displayName: 'Qwen Code', skillsDir: '.qwen/skills' },
      replit: { displayName: 'Replit', skillsDir: '.agents/skills' },
      roo: { displayName: 'Roo Code', skillsDir: '.roo/skills' },
      trae: { displayName: 'Trae', skillsDir: '.trae/skills' },
      'trae-cn': { displayName: 'Trae CN', skillsDir: '.trae/skills' },
      windsurf: { displayName: 'Windsurf', skillsDir: '.windsurf/skills' },
      zencoder: { displayName: 'Zencoder', skillsDir: '.zencoder/skills' },
      neovate: { displayName: 'Neovate', skillsDir: '.neovate/skills' },
      pochi: { displayName: 'Pochi', skillsDir: '.pochi/skills' },
      adal: { displayName: 'AdaL', skillsDir: '.adal/skills' },
    };

    for (const [id, exp] of Object.entries(expected)) {
      it(`${id}: displayName="${exp.displayName}", skillsDir="${exp.skillsDir}"`, () => {
        const p = getProvider(id);
        expect(p).toBeDefined();
        expect(p!.displayName).toBe(exp.displayName);
        expect(p!.skillsDir).toBe(exp.skillsDir);
      });
    }
  });

  describe('replit showInUniversalList is false', () => {
    it('replit has showInUniversalList=false', () => {
      const replit = getProvider('replit');
      expect(replit?.showInUniversalList).toBe(false);
    });
  });
});

describe('Cursor pilot integration', () => {
  it('has full MCP integration', () => {
    const cursor = getProvider('cursor')!;
    expect(cursor.mcp).toBeDefined();
    expect(cursor.mcp!.format).toBe('json');
    expect(cursor.mcp!.serversKey).toBe('mcpServers');
    expect(cursor.mcp!.serverKey).toBe('capa');
    expect(cursor.mcp!.supportsSubAgentEntries).toBe(false);
  });

  it('has instructions integration (AGENTS.md)', () => {
    const cursor = getProvider('cursor')!;
    expect(cursor.instructions).toBeDefined();
    expect(cursor.instructions!.filename).toBe('AGENTS.md');
  });

  it('has rules integration (.cursor/rules/*.mdc)', () => {
    const cursor = getProvider('cursor')!;
    expect(cursor.rules).toBeDefined();
    expect(cursor.rules!.dir).toBe('.cursor/rules');
    expect(cursor.rules!.extension).toBe('.mdc');
    expect(cursor.rules!.frontmatter).toBe('yaml');
  });

  it('has subagents integration (.cursor/agents/*.md)', () => {
    const cursor = getProvider('cursor')!;
    expect(cursor.subagents).toBeDefined();
    expect(cursor.subagents!.dir).toBe('.cursor/agents');
    expect(cursor.subagents!.extension).toBe('.md');
    expect(cursor.subagents!.format).toBe('markdown-frontmatter');
  });

  it('has plugin manifest paths', () => {
    const cursor = getProvider('cursor')!;
    expect(cursor.pluginManifestPaths).toEqual(['.cursor-plugin/plugin.json']);
  });
});

describe('Claude Code pilot integration', () => {
  it('has full MCP integration', () => {
    const claude = getProvider('claude-code')!;
    expect(claude.mcp).toBeDefined();
    expect(claude.mcp!.format).toBe('json');
    expect(claude.mcp!.serversKey).toBe('mcpServers');
    expect(claude.mcp!.serverKey).toBe('capa');
    expect(claude.mcp!.supportsSubAgentEntries).toBe(true);
  });

  it('has instructions integration (CLAUDE.md)', () => {
    const claude = getProvider('claude-code')!;
    expect(claude.instructions).toBeDefined();
    expect(claude.instructions!.filename).toBe('CLAUDE.md');
  });

  it('has no rules integration', () => {
    const claude = getProvider('claude-code')!;
    expect(claude.rules).toBeUndefined();
  });

  it('has subagents integration (.claude/agents/*.md)', () => {
    const claude = getProvider('claude-code')!;
    expect(claude.subagents).toBeDefined();
    expect(claude.subagents!.dir).toBe('.claude/agents');
    expect(claude.subagents!.extension).toBe('.md');
    expect(claude.subagents!.format).toBe('markdown-frontmatter');
  });

  it('has plugin manifest paths', () => {
    const claude = getProvider('claude-code')!;
    expect(claude.pluginManifestPaths).toEqual(['.claude-plugin/plugin.json']);
  });
});

describe('Codex pilot integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-codex-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('has full MCP integration (TOML)', () => {
    const codex = getProvider('codex')!;
    expect(codex.mcp).toBeDefined();
    expect(codex.mcp!.format).toBe('toml');
    expect(codex.mcp!.serversKey).toBe('mcp_servers');
    expect(codex.mcp!.serverKey).toBe('capa');
    expect(codex.mcp!.supportsSubAgentEntries).toBe(true);
  });

  it('has instructions integration (AGENTS.md)', () => {
    const codex = getProvider('codex')!;
    expect(codex.instructions).toBeDefined();
    expect(codex.instructions!.filename).toBe('AGENTS.md');
  });

  it('has no rules integration (folded into AGENTS.md)', () => {
    const codex = getProvider('codex')!;
    expect(codex.rules).toBeUndefined();
  });

  it('has subagents integration (.codex/agents/*.toml)', () => {
    const codex = getProvider('codex')!;
    expect(codex.subagents).toBeDefined();
    expect(codex.subagents!.dir).toBe('.codex/agents');
    expect(codex.subagents!.extension).toBe('.toml');
    expect(codex.subagents!.format).toBe('toml');
  });

  it('has no plugin manifest paths', () => {
    const codex = getProvider('codex')!;
    expect(codex.pluginManifestPaths).toBeUndefined();
  });

  it('MCP configPath resolves to .codex/config.toml', () => {
    const codex = getProvider('codex')!;
    expect(codex.mcp!.configPath).toBe('.codex/config.toml');
    const configPath = getMcpConfigPath(codex, tempDir);
    expect(configPath).toBe(join(tempDir, '.codex', 'config.toml'));
  });

  it('MCP buildMcpEntry returns url object', () => {
    const codex = getProvider('codex')!;
    const entry = buildMcpEntry(codex.mcp!, 'http://localhost:3000/mcp');
    expect(entry).toEqual({ url: 'http://localhost:3000/mcp' });
  });

  it('buildSubAgentFile produces valid TOML', () => {
    const codex = getProvider('codex')!;
    const subAgent = {
      id: 'test-agent',
      description: 'A test sub-agent',
      skills: ['skill-a'],
      tools: ['tool-x'],
      instructions: 'Do the thing.',
    };
    const capabilities = {
      providers: ['codex'],
      skills: [],
      servers: [],
      tools: [{ id: 'tool-x', type: 'mcp' as const, def: { server: '@s', tool: 'tool-x' } }],
    };

    const result = buildSubAgentFile(codex, subAgent, capabilities);
    const parsed = TOML.parse(result) as any;

    expect(parsed.name).toBe('test-agent');
    expect(parsed.description).toBe('A test sub-agent');
    expect(parsed.developer_instructions).toBeString();
    expect(parsed.developer_instructions).toContain('skill-a');
    expect(parsed.developer_instructions).toContain('s.tool-x');
  });
});

describe('Codex MCP round-trip via mcp-client-manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-codex-mcp-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('registers capa MCP server in .codex/config.toml', async () => {
    const { registerMCPServer } = await import('../../../cli/utils/mcp-client-manager');
    await registerMCPServer(tempDir, 'proj-1', 'http://localhost:3000/mcp', ['codex']);

    const configPath = join(tempDir, '.codex', 'config.toml');
    expect(existsSync(configPath)).toBe(true);

    const content = readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content) as any;
    expect(parsed.mcp_servers.capa.url).toBe('http://localhost:3000/mcp');
  });

  it('preserves existing TOML keys when registering', async () => {
    const codexDir = join(tempDir, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const configPath = join(codexDir, 'config.toml');
    writeFileSync(configPath, 'model = "o3"\n', 'utf-8');

    const { registerMCPServer } = await import('../../../cli/utils/mcp-client-manager');
    await registerMCPServer(tempDir, 'proj-1', 'http://localhost:3000/mcp', ['codex']);

    const content = readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content) as any;
    expect(parsed.model).toBe('o3');
    expect(parsed.mcp_servers.capa.url).toBe('http://localhost:3000/mcp');
  });

  it('unregisters capa MCP server from .codex/config.toml', async () => {
    const { registerMCPServer, unregisterMCPServer } = await import('../../../cli/utils/mcp-client-manager');
    await registerMCPServer(tempDir, 'proj-1', 'http://localhost:3000/mcp', ['codex']);
    await unregisterMCPServer(tempDir, 'proj-1', ['codex']);

    const configPath = join(tempDir, '.codex', 'config.toml');
    const content = readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content) as any;
    expect(parsed.mcp_servers?.capa).toBeUndefined();
  });

  it('registers sub-agent MCP entry in .codex/config.toml', async () => {
    const { registerSubAgentMCPServer } = await import('../../../cli/utils/mcp-client-manager');
    await registerSubAgentMCPServer(tempDir, 'research', 'http://localhost:3000/agents/research/mcp', ['codex']);

    const configPath = join(tempDir, '.codex', 'config.toml');
    const content = readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content) as any;
    expect(parsed.mcp_servers['capa-research'].url).toBe('http://localhost:3000/agents/research/mcp');
  });
});

describe('Codex rules as AGENTS.md marker blocks', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-codex-rules-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('installs rules as marker blocks in AGENTS.md for codex provider', async () => {
    const { installRules } = await import('../../../cli/utils/rules-installer');
    const rules = [
      {
        id: 'test-rule',
        type: 'inline' as const,
        content: 'Always use TypeScript.',
      },
    ];
    const resolvedContent = new Map([['test-rule', 'Always use TypeScript.']]);
    installRules(tempDir, rules, ['codex'], resolvedContent);

    const agentsMd = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('<!-- capa:start:rule:test-rule -->');
    expect(agentsMd).toContain('Always use TypeScript.');
    expect(agentsMd).toContain('<!-- capa:end:rule:test-rule -->');
  });

  it('cleanRules removes rule markers from AGENTS.md', async () => {
    const { installRules, cleanRules } = await import('../../../cli/utils/rules-installer');
    const rules = [{ id: 'r1', type: 'inline' as const, content: 'Rule content.' }];
    const content = new Map([['r1', 'Rule content.']]);
    installRules(tempDir, rules, ['codex'], content);
    cleanRules(tempDir, ['codex'], ['r1']);

    const agentsMd = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).not.toContain('<!-- capa:start:rule:r1 -->');
  });
});

describe('Cursor rules as .mdc files', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-cursor-rules-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('installs rules as .mdc files in .cursor/rules/', async () => {
    const { installRules } = await import('../../../cli/utils/rules-installer');
    const rules = [
      {
        id: 'style-guide',
        type: 'inline' as const,
        description: 'Enforce coding style',
        appliesTo: ['*.ts', '*.tsx'],
        alwaysApply: true,
        content: 'Use 2-space indentation.',
      },
    ];
    const resolvedContent = new Map([['style-guide', 'Use 2-space indentation.']]);
    installRules(tempDir, rules, ['cursor'], resolvedContent);

    const mdcPath = join(tempDir, '.cursor', 'rules', 'style-guide.mdc');
    expect(existsSync(mdcPath)).toBe(true);

    const content = readFileSync(mdcPath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('description: Enforce coding style');
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('Use 2-space indentation.');
  });

  it('cleanRules removes only capa-managed .mdc files from .cursor/rules/', async () => {
    const { installRules, cleanRules } = await import('../../../cli/utils/rules-installer');
    const rules = [{ id: 'r1', type: 'inline' as const, content: 'Rule.' }];
    installRules(tempDir, rules, ['cursor'], new Map([['r1', 'Rule.']]));
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'r1.mdc'))).toBe(true);

    // Write a user-authored .mdc file that should NOT be deleted
    writeFileSync(join(tempDir, '.cursor', 'rules', 'user-rule.mdc'), 'My custom rule', 'utf-8');

    cleanRules(tempDir, ['cursor'], ['r1']);
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'r1.mdc'))).toBe(false);
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'user-rule.mdc'))).toBe(true);
  });
});

describe('Rules: managed-file registration + pruning', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-rules-prune-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('installRules invokes onFileWritten for every directory-based rule it writes', async () => {
    const { installRules } = await import('../../../cli/utils/rules-installer');
    const rules = [
      { id: 'r1', type: 'inline' as const, content: 'one' },
      { id: 'r2', type: 'inline' as const, content: 'two' },
    ];
    const written: string[] = [];
    installRules(
      tempDir,
      rules,
      ['cursor'],
      new Map([
        ['r1', 'one'],
        ['r2', 'two'],
      ]),
      { onFileWritten: (p) => written.push(p) }
    );
    expect(written.sort()).toEqual([
      join(tempDir, '.cursor', 'rules', 'r1.mdc'),
      join(tempDir, '.cursor', 'rules', 'r2.mdc'),
    ]);
  });

  it('installRules does NOT invoke onFileWritten for instruction-folded providers', async () => {
    // Marker-block rules are tracked via the inline marker, not the
    // managed-files DB, so the callback should stay silent for codex.
    const { installRules } = await import('../../../cli/utils/rules-installer');
    const written: string[] = [];
    installRules(
      tempDir,
      [{ id: 'only-rule', type: 'inline' as const, content: 'x' }],
      ['codex'],
      new Map([['only-rule', 'x']]),
      { onFileWritten: (p) => written.push(p) }
    );
    expect(written).toEqual([]);
  });

  it('pruneRules removes a directory-based rule that was dropped from the config', async () => {
    const { installRules, pruneRules } = await import('../../../cli/utils/rules-installer');
    const written: string[] = [];
    installRules(
      tempDir,
      [
        { id: 'kept', type: 'inline' as const, content: 'keep' },
        { id: 'gone', type: 'inline' as const, content: 'drop' },
      ],
      ['cursor'],
      new Map([['kept', 'keep'], ['gone', 'drop']]),
      { onFileWritten: (p) => written.push(p) }
    );

    const keptPath = join(tempDir, '.cursor', 'rules', 'kept.mdc');
    const gonePath = join(tempDir, '.cursor', 'rules', 'gone.mdc');
    expect(existsSync(keptPath)).toBe(true);
    expect(existsSync(gonePath)).toBe(true);

    // Re-install with `gone` removed from the config; it should be pruned.
    const result = pruneRules(
      tempDir,
      ['cursor'],
      [{ id: 'kept', type: 'inline' as const, content: 'keep' }],
      written
    );
    expect(existsSync(keptPath)).toBe(true);
    expect(existsSync(gonePath)).toBe(false);
    expect(result.removedFiles).toEqual([gonePath]);
    expect(result.removedMarkers).toEqual([]);
  });

  it('pruneRules removes ALL rule files when the rules section is emptied', async () => {
    const { installRules, pruneRules } = await import('../../../cli/utils/rules-installer');
    const written: string[] = [];
    installRules(
      tempDir,
      [
        { id: 'a', type: 'inline' as const, content: 'a' },
        { id: 'b', type: 'inline' as const, content: 'b' },
      ],
      ['cursor'],
      new Map([['a', 'a'], ['b', 'b']]),
      { onFileWritten: (p) => written.push(p) }
    );
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'a.mdc'))).toBe(true);
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'b.mdc'))).toBe(true);

    const result = pruneRules(tempDir, ['cursor'], [], written);
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'a.mdc'))).toBe(false);
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'b.mdc'))).toBe(false);
    expect(result.removedFiles.sort()).toEqual([
      join(tempDir, '.cursor', 'rules', 'a.mdc'),
      join(tempDir, '.cursor', 'rules', 'b.mdc'),
    ]);
  });

  it('pruneRules never deletes user-authored files in the rules dir', async () => {
    const { pruneRules } = await import('../../../cli/utils/rules-installer');
    mkdirSync(join(tempDir, '.cursor', 'rules'), { recursive: true });
    const userPath = join(tempDir, '.cursor', 'rules', 'user-rule.mdc');
    writeFileSync(userPath, 'user-authored', 'utf-8');

    // Empty managed-files list = capa never wrote anything = nothing to delete,
    // even though the user has a file in the rules dir whose name might match
    // a future rule.
    const result = pruneRules(tempDir, ['cursor'], [], []);
    expect(existsSync(userPath)).toBe(true);
    expect(result.removedFiles).toEqual([]);
  });

  it('pruneRules removes the marker block for a removed rule but keeps current ones', async () => {
    const { installRules, pruneRules } = await import('../../../cli/utils/rules-installer');
    installRules(
      tempDir,
      [
        { id: 'kept', type: 'inline' as const, content: 'keep' },
        { id: 'gone', type: 'inline' as const, content: 'drop' },
      ],
      ['codex'],
      new Map([['kept', 'keep'], ['gone', 'drop']])
    );
    const before = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(before).toContain('<!-- capa:start:rule:kept -->');
    expect(before).toContain('<!-- capa:start:rule:gone -->');

    const result = pruneRules(
      tempDir,
      ['codex'],
      [{ id: 'kept', type: 'inline' as const, content: 'keep' }],
      []
    );
    const after = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(after).toContain('<!-- capa:start:rule:kept -->');
    expect(after).not.toContain('<!-- capa:start:rule:gone -->');
    expect(result.removedMarkers).toEqual(['gone']);
  });

  it('pruneRules removes ALL marker blocks when the rules section is emptied', async () => {
    const { installRules, pruneRules } = await import('../../../cli/utils/rules-installer');
    installRules(
      tempDir,
      [
        { id: 'a', type: 'inline' as const, content: 'a' },
        { id: 'b', type: 'inline' as const, content: 'b' },
      ],
      ['codex'],
      new Map([['a', 'a'], ['b', 'b']])
    );

    const result = pruneRules(tempDir, ['codex'], [], []);
    const after = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(after).not.toContain('<!-- capa:start:rule:a -->');
    expect(after).not.toContain('<!-- capa:start:rule:b -->');
    expect(result.removedMarkers.sort()).toEqual(['a', 'b']);
  });

  it('pruneRules respects per-rule provider filtering (rule restricted to other provider counts as absent)', async () => {
    const { installRules, pruneRules } = await import('../../../cli/utils/rules-installer');
    // Install a rule restricted to cursor; codex should never have written anything for it.
    installRules(
      tempDir,
      [{ id: 'cursor-only', type: 'inline' as const, content: 'x', providers: ['cursor'] }],
      ['cursor', 'codex'],
      new Map([['cursor-only', 'x']])
    );
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'cursor-only.mdc'))).toBe(true);
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(false);

    // From codex's perspective the rule is not desired, so a stray block in
    // codex's AGENTS.md (if one existed) should be pruned. Simulate that by
    // hand-installing a marker block and running prune.
    writeFileSync(
      join(tempDir, 'AGENTS.md'),
      '<!-- capa:start:rule:cursor-only -->\nstray\n<!-- capa:end:rule:cursor-only -->\n',
      'utf-8'
    );
    const result = pruneRules(
      tempDir,
      ['codex'],
      [{ id: 'cursor-only', type: 'inline' as const, content: 'x', providers: ['cursor'] }],
      []
    );
    const after = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(after).not.toContain('<!-- capa:start:rule:cursor-only -->');
    expect(result.removedMarkers).toEqual(['cursor-only']);
  });

  it('pruneRules ignores managed files outside the provider rules dir (no false deletions)', async () => {
    const { pruneRules } = await import('../../../cli/utils/rules-installer');
    // A skill directory is "managed" but lives elsewhere. pruneRules must
    // never touch it even when the rules dir would match the basename.
    const skillDir = join(tempDir, '.agents', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    writeFileSync(skillFile, '# skill', 'utf-8');

    const result = pruneRules(tempDir, ['cursor'], [], [skillDir, skillFile]);
    expect(existsSync(skillFile)).toBe(true);
    expect(result.removedFiles).toEqual([]);
  });
});

describe('Codex skill installation path', () => {
  it('uses .agents/skills as its skillsDir', () => {
    const codex = getProvider('codex')!;
    expect(codex.skillsDir).toBe('.agents/skills');
  });
});

describe('GitHub Copilot integration', () => {
  it('has MCP integration (.vscode/mcp.json)', () => {
    const copilot = getProvider('github-copilot')!;
    expect(copilot.mcp).toBeDefined();
    expect(copilot.mcp!.configPath).toBe('.vscode/mcp.json');
    expect(copilot.mcp!.format).toBe('json');
    expect(copilot.mcp!.serversKey).toBe('servers');
    expect(copilot.mcp!.serverKey).toBe('capa');
    expect(copilot.mcp!.entryUrlKey).toBe('url');
    expect(copilot.mcp!.supportsSubAgentEntries).toBe(false);
  });

  it('has instructions integration (.github/copilot-instructions.md)', () => {
    const copilot = getProvider('github-copilot')!;
    expect(copilot.instructions).toBeDefined();
    expect(copilot.instructions!.filename).toBe('.github/copilot-instructions.md');
  });

  it('has rules integration (.github/instructions/*.instructions.md)', () => {
    const copilot = getProvider('github-copilot')!;
    expect(copilot.rules).toBeDefined();
    expect(copilot.rules!.dir).toBe('.github/instructions');
    expect(copilot.rules!.extension).toBe('.instructions.md');
    expect(copilot.rules!.frontmatter).toBe('yaml');
    expect(copilot.rules!.fieldMap?.appliesTo).toBe('applyTo');
  });

  it('has subagents integration (.github/agents/*.md)', () => {
    const copilot = getProvider('github-copilot')!;
    expect(copilot.subagents).toBeDefined();
    expect(copilot.subagents!.dir).toBe('.github/agents');
    expect(copilot.subagents!.extension).toBe('.md');
    expect(copilot.subagents!.format).toBe('markdown-frontmatter');
  });
});

describe('OpenCode integration', () => {
  it('has MCP integration (.opencode/opencode.json)', () => {
    const oc = getProvider('opencode')!;
    expect(oc.mcp).toBeDefined();
    expect(oc.mcp!.configPath).toBe('.opencode/opencode.json');
    expect(oc.mcp!.format).toBe('json');
    expect(oc.mcp!.serversKey).toBe('mcp');
    expect(oc.mcp!.serverKey).toBe('capa');
    expect(oc.mcp!.supportsSubAgentEntries).toBe(true);
  });

  it('has instructions integration (AGENTS.md)', () => {
    const oc = getProvider('opencode')!;
    expect(oc.instructions).toBeDefined();
    expect(oc.instructions!.filename).toBe('AGENTS.md');
  });

  it('has subagents integration (.opencode/agents/*.md)', () => {
    const oc = getProvider('opencode')!;
    expect(oc.subagents).toBeDefined();
    expect(oc.subagents!.dir).toBe('.opencode/agents');
    expect(oc.subagents!.extension).toBe('.md');
    expect(oc.subagents!.format).toBe('markdown-frontmatter');
  });
});

describe('Windsurf integration', () => {
  it('has no MCP integration (global only)', () => {
    const ws = getProvider('windsurf')!;
    expect(ws.mcp).toBeUndefined();
  });

  it('has rules integration (.windsurf/rules/*.md)', () => {
    const ws = getProvider('windsurf')!;
    expect(ws.rules).toBeDefined();
    expect(ws.rules!.dir).toBe('.windsurf/rules');
    expect(ws.rules!.extension).toBe('.md');
    expect(ws.rules!.frontmatter).toBe('yaml');
    expect(ws.rules!.fieldMap?.description).toBe('description');
    expect(ws.rules!.fieldMap?.appliesTo).toBe('globs');
    expect(ws.rules!.fieldMap?.alwaysApply).toBe('trigger');
    expect(ws.rules!.fieldMap?.alwaysApplyValues).toEqual({
      trueValue: 'always_on',
      falseValue: 'model_decision',
    });
  });
});

describe('Roo Code integration', () => {
  it('has MCP integration (.roo/mcp.json)', () => {
    const roo = getProvider('roo')!;
    expect(roo.mcp).toBeDefined();
    expect(roo.mcp!.configPath).toBe('.roo/mcp.json');
    expect(roo.mcp!.format).toBe('json');
    expect(roo.mcp!.serversKey).toBe('mcpServers');
    expect(roo.mcp!.serverKey).toBe('capa');
    expect(roo.mcp!.supportsSubAgentEntries).toBe(true);
  });

  it('has no rules integration', () => {
    const roo = getProvider('roo')!;
    expect(roo.rules).toBeUndefined();
  });

  it('has no subagents integration', () => {
    const roo = getProvider('roo')!;
    expect(roo.subagents).toBeUndefined();
  });
});

describe('Windsurf rules frontmatter with alwaysApplyValues', () => {
  it('maps alwaysApply=true to trigger: always_on', async () => {
    const { buildRuleFrontmatter } = await import('../handlers');
    const ws = getProvider('windsurf')!;
    const fm = buildRuleFrontmatter(ws.rules!, {
      id: 'test',
      description: 'Test rule',
      alwaysApply: true,
    });
    expect(fm.trigger).toBe('always_on');
    expect(fm.description).toBe('Test rule');
  });

  it('maps alwaysApply=false to trigger: model_decision', async () => {
    const { buildRuleFrontmatter } = await import('../handlers');
    const ws = getProvider('windsurf')!;
    const fm = buildRuleFrontmatter(ws.rules!, {
      id: 'test',
      description: 'Test rule',
      alwaysApply: false,
    });
    expect(fm.trigger).toBe('model_decision');
  });

  it('maps alwaysApply=undefined to trigger: model_decision', async () => {
    const { buildRuleFrontmatter } = await import('../handlers');
    const ws = getProvider('windsurf')!;
    const fm = buildRuleFrontmatter(ws.rules!, {
      id: 'test',
      description: 'Test rule',
    });
    expect(fm.trigger).toBe('model_decision');
  });
});
