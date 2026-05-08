// Provider registry — the single source of truth for all per-provider facts.
//
// Skill-path data (skillsDir, globalSkillsDir, detectInstalled) was originally
// maintained in the vercel-labs/skills package (v1.3.7, commit a600598).
// It is ported here verbatim so capa owns its own agent registry without an
// external GitHub-pinned dependency.

import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ProviderIntegration } from '../../types/providers';

let _xdgConfig: string | undefined;
try {
  // xdg-basedir is already a capa dependency; import lazily to keep the
  // module-level side-effects minimal.
  const mod = await import('xdg-basedir');
  _xdgConfig = mod.xdgConfig ?? undefined;
} catch {
  // fallback handled below
}

const home = homedir();
const configHome = _xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

/**
 * All known providers. Cursor, Claude Code, and Codex include full
 * MCP/instructions/rules/subagents/plugin integration data inline.
 * All other entries are skill-path only for now.
 */
export const providers: Record<string, ProviderIntegration> = {
  amp: {
    id: 'amp',
    displayName: 'Amp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    detectInstalled: async () => existsSync(join(configHome, 'amp')),
  },
  antigravity: {
    id: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: '.agent/skills',
    globalSkillsDir: join(home, '.gemini/antigravity/skills'),
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.agent')) || existsSync(join(home, '.gemini/antigravity')),
  },
  augment: {
    id: 'augment',
    displayName: 'Augment',
    skillsDir: '.augment/skills',
    globalSkillsDir: join(home, '.augment/skills'),
    detectInstalled: async () => existsSync(join(home, '.augment')),
  },
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    detectInstalled: async () => existsSync(claudeHome),
    mcp: {
      configPath: '.mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'CLAUDE.md' },
    subagents: {
      dir: '.claude/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
      fields: { model: 'inherit' },
    },
    pluginManifestPaths: ['.claude-plugin/plugin.json'],
  },
  openclaw: {
    id: 'openclaw',
    displayName: 'OpenClaw',
    skillsDir: 'skills',
    globalSkillsDir: existsSync(join(home, '.openclaw'))
      ? join(home, '.openclaw/skills')
      : existsSync(join(home, '.clawdbot'))
        ? join(home, '.clawdbot/skills')
        : join(home, '.moltbot/skills'),
    detectInstalled: async () =>
      existsSync(join(home, '.openclaw')) ||
      existsSync(join(home, '.clawdbot')) ||
      existsSync(join(home, '.moltbot')),
  },
  cline: {
    id: 'cline',
    displayName: 'Cline',
    skillsDir: '.cline/skills',
    globalSkillsDir: join(home, '.cline/skills'),
    detectInstalled: async () => existsSync(join(home, '.cline')),
  },
  codebuddy: {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    skillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy')),
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    detectInstalled: async () => existsSync(codexHome) || existsSync('/etc/codex'),
    mcp: {
      configPath: '.codex/config.toml',
      format: 'toml',
      serversKey: 'mcp_servers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.codex/agents',
      extension: '.toml',
      format: 'toml',
      bodyField: 'developer_instructions',
    },
  },
  'command-code': {
    id: 'command-code',
    displayName: 'Command Code',
    skillsDir: '.commandcode/skills',
    globalSkillsDir: join(home, '.commandcode/skills'),
    detectInstalled: async () => existsSync(join(home, '.commandcode')),
  },
  continue: {
    id: 'continue',
    displayName: 'Continue',
    skillsDir: '.continue/skills',
    globalSkillsDir: join(home, '.continue/skills'),
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.continue')) || existsSync(join(home, '.continue')),
  },
  crush: {
    id: 'crush',
    displayName: 'Crush',
    skillsDir: '.crush/skills',
    globalSkillsDir: join(home, '.config/crush/skills'),
    detectInstalled: async () => existsSync(join(home, '.config/crush')),
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    detectInstalled: async () => existsSync(join(home, '.cursor')),
    mcp: {
      configPath: '.cursor/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: false,
    },
    instructions: { filename: 'AGENTS.md' },
    rules: {
      dir: '.cursor/rules',
      extension: '.mdc',
      frontmatter: 'yaml',
      fieldMap: { description: 'description', appliesTo: 'globs', alwaysApply: 'alwaysApply' },
    },
    subagents: {
      dir: '.cursor/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
      fields: { model: 'inherit', readonly: false, is_background: false },
    },
    pluginManifestPaths: ['.cursor-plugin/plugin.json'],
  },
  droid: {
    id: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    detectInstalled: async () => existsSync(join(home, '.factory')),
  },
  'gemini-cli': {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    detectInstalled: async () => existsSync(join(home, '.gemini')),
  },
  'github-copilot': {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.github')) || existsSync(join(home, '.copilot')),
  },
  goose: {
    id: 'goose',
    displayName: 'Goose',
    skillsDir: '.goose/skills',
    globalSkillsDir: join(configHome, 'goose/skills'),
    detectInstalled: async () => existsSync(join(configHome, 'goose')),
  },
  junie: {
    id: 'junie',
    displayName: 'Junie',
    skillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    detectInstalled: async () => existsSync(join(home, '.junie')),
  },
  'iflow-cli': {
    id: 'iflow-cli',
    displayName: 'iFlow CLI',
    skillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    detectInstalled: async () => existsSync(join(home, '.iflow')),
  },
  kilo: {
    id: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    detectInstalled: async () => existsSync(join(home, '.kilocode')),
  },
  'kimi-cli': {
    id: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.config/agents/skills'),
    detectInstalled: async () => existsSync(join(home, '.kimi')),
  },
  'kiro-cli': {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    detectInstalled: async () => existsSync(join(home, '.kiro')),
  },
  kode: {
    id: 'kode',
    displayName: 'Kode',
    skillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    detectInstalled: async () => existsSync(join(home, '.kode')),
  },
  mcpjam: {
    id: 'mcpjam',
    displayName: 'MCPJam',
    skillsDir: '.mcpjam/skills',
    globalSkillsDir: join(home, '.mcpjam/skills'),
    detectInstalled: async () => existsSync(join(home, '.mcpjam')),
  },
  'mistral-vibe': {
    id: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    skillsDir: '.vibe/skills',
    globalSkillsDir: join(home, '.vibe/skills'),
    detectInstalled: async () => existsSync(join(home, '.vibe')),
  },
  mux: {
    id: 'mux',
    displayName: 'Mux',
    skillsDir: '.mux/skills',
    globalSkillsDir: join(home, '.mux/skills'),
    detectInstalled: async () => existsSync(join(home, '.mux')),
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'opencode/skills'),
    detectInstalled: async () =>
      existsSync(join(configHome, 'opencode')) || existsSync(join(claudeHome, 'skills')),
  },
  openhands: {
    id: 'openhands',
    displayName: 'OpenHands',
    skillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    detectInstalled: async () => existsSync(join(home, '.openhands')),
  },
  pi: {
    id: 'pi',
    displayName: 'Pi',
    skillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    detectInstalled: async () => existsSync(join(home, '.pi/agent')),
  },
  qoder: {
    id: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    detectInstalled: async () => existsSync(join(home, '.qoder')),
  },
  'qwen-code': {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    skillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    detectInstalled: async () => existsSync(join(home, '.qwen')),
  },
  replit: {
    id: 'replit',
    displayName: 'Replit',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    showInUniversalList: false,
    detectInstalled: async () => existsSync(join(process.cwd(), '.agents')),
  },
  roo: {
    id: 'roo',
    displayName: 'Roo Code',
    skillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    detectInstalled: async () => existsSync(join(home, '.roo')),
  },
  trae: {
    id: 'trae',
    displayName: 'Trae',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    detectInstalled: async () => existsSync(join(home, '.trae')),
  },
  'trae-cn': {
    id: 'trae-cn',
    displayName: 'Trae CN',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    detectInstalled: async () => existsSync(join(home, '.trae-cn')),
  },
  windsurf: {
    id: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    detectInstalled: async () => existsSync(join(home, '.codeium/windsurf')),
  },
  zencoder: {
    id: 'zencoder',
    displayName: 'Zencoder',
    skillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    detectInstalled: async () => existsSync(join(home, '.zencoder')),
  },
  neovate: {
    id: 'neovate',
    displayName: 'Neovate',
    skillsDir: '.neovate/skills',
    globalSkillsDir: join(home, '.neovate/skills'),
    detectInstalled: async () => existsSync(join(home, '.neovate')),
  },
  pochi: {
    id: 'pochi',
    displayName: 'Pochi',
    skillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    detectInstalled: async () => existsSync(join(home, '.pochi')),
  },
  adal: {
    id: 'adal',
    displayName: 'AdaL',
    skillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    detectInstalled: async () => existsSync(join(home, '.adal')),
  },
};
