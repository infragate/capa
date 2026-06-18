// Provider registry — the single source of truth for all per-provider facts.

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
    // Antigravity IDE has no project-local MCP file; the CLI uses
    // `.agents/mcp_config.json` with `serverUrl` (not `url`). Holding off
    // until we either split into antigravity-cli or extend McpIntegration.
    instructions: { filename: 'AGENTS.md' },
    rules: {
      dir: '.agents/rules',
      extension: '.md',
      frontmatter: 'none',
    },
  },
  augment: {
    id: 'augment',
    displayName: 'Augment',
    skillsDir: '.augment/skills',
    globalSkillsDir: join(home, '.augment/skills'),
    detectInstalled: async () => existsSync(join(home, '.augment')),
    // MCP is global-only (~/.augment/settings.json); no project-local file.
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.augment/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
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
      entryType: 'http',
      supportsSubAgentEntries: true,
      defaultMcpFallbackPath: '.mcp.json',
    },
    instructions: { filename: 'CLAUDE.md' },
    rules: {
      dir: '.claude/rules',
      extension: '.md',
      frontmatter: 'yaml',
      fieldMap: { appliesTo: 'paths' },
    },
    subagents: {
      dir: '.claude/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
      fields: { model: 'inherit' },
    },
    pluginManifestPaths: ['.claude-plugin/plugin.json'],
    pluginProviderId: 'claude',
    hooks: {
      // Claude Code reads hooks from the project-local .claude/settings.json.
      // Docs: https://docs.claude.com/en/docs/claude-code/hooks
      storage: {
        kind: 'inline-config',
        configPath: '.claude/settings.json',
        format: 'json',
        hooksKey: 'hooks',
      },
      shape: 'claude',
      supportsNameTag: true,
      eventMap: {
        sessionStart: { event: 'SessionStart' },
        sessionEnd: { event: 'SessionEnd' },
        userPromptSubmit: { event: 'UserPromptSubmit' },
        beforeTool: { event: 'PreToolUse' },
        afterTool: { event: 'PostToolUse' },
        beforeShell: { event: 'PreToolUse', matcherPrefix: 'Bash' },
        afterShell: { event: 'PostToolUse', matcherPrefix: 'Bash' },
        afterFileEdit: {
          event: 'PostToolUse',
          matcherPrefix: 'Edit|MultiEdit|Write',
        },
        beforeMcpCall: { event: 'PreToolUse', matcherPrefix: 'mcp__' },
        afterMcpCall: { event: 'PostToolUse', matcherPrefix: 'mcp__' },
        subagentStop: { event: 'SubagentStop' },
        preCompact: { event: 'PreCompact' },
        stop: { event: 'Stop' },
      },
    },
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
    // MCP is global-only (~/.cline/mcp.json); no project-local file.
    instructions: { filename: 'AGENTS.md' },
  },
  codebuddy: {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    skillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy')),
    // `.mcp.json` is documented for the CodeBuddy CLI only, not the IDE.
    mcp: {
      configPath: '.mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'http',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'CODEBUDDY.md' },
    // Skipping rules — CodeBuddy uses `.codebuddy/rules/<name>/RULE.mdc`
    // (directory-per-rule), which doesn't match capa's flat file model.
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
    hooks: {
      // Codex reads hooks from .codex/config.toml as a [hooks] table whose
      // shape is *structurally identical* to Claude's `.claude/settings.json`
      // hook map: a top-level event key holds an array of matcher groups
      // (`{ matcher, hooks: [...] }`), and each handler in the inner `hooks`
      // array is a `{ type, command, ... }` table. Capa therefore reuses the
      // `claude` shape handler — the only difference is TOML vs JSON
      // serialisation (handled by `storage.format`).
      //
      // Codex's TOML form (per `codex-rs/config/src/hook_config.rs`) is:
      //   [[hooks.PreToolUse]]
      //   matcher = "Bash"
      //   [[hooks.PreToolUse.hooks]]
      //   type = "command"
      //   command = "..."
      //
      // Identification: `MatcherGroup` and `HookHandlerConfig` do NOT use
      // `#[serde(deny_unknown_fields)]`, so capa appends an opaque
      // `name = "capa:<id>"` field on entries it owns. Codex ignores it but
      // round-trips it through writes; capa uses it for surgical updates.
      //
      // Built-in matcher tool names are `Bash`, `apply_patch`, and
      // `mcp__server__tool` for MCP. Events without a matcher
      // (UserPromptSubmit, Stop, …) accept an empty/omitted matcher.
      // Docs: https://developers.openai.com/codex/hooks
      storage: {
        kind: 'inline-config',
        configPath: '.codex/config.toml',
        format: 'toml',
        hooksKey: 'hooks',
      },
      shape: 'claude',
      supportsNameTag: true,
      eventMap: {
        sessionStart: { event: 'SessionStart' },
        userPromptSubmit: { event: 'UserPromptSubmit' },
        beforeTool: { event: 'PreToolUse' },
        afterTool: { event: 'PostToolUse' },
        beforeShell: { event: 'PreToolUse', matcherPrefix: 'Bash' },
        afterShell: { event: 'PostToolUse', matcherPrefix: 'Bash' },
        afterFileEdit: { event: 'PostToolUse', matcherPrefix: 'apply_patch' },
        beforeMcpCall: { event: 'PreToolUse', matcherPrefix: 'mcp__' },
        afterMcpCall: { event: 'PostToolUse', matcherPrefix: 'mcp__' },
        subagentStart: { event: 'SubagentStart' },
        subagentStop: { event: 'SubagentStop' },
        preCompact: { event: 'PreCompact' },
        stop: { event: 'Stop' },
      },
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
    mcp: {
      // Crush uses `mcp` (not `mcpServers`) at the top of `.crush.json`.
      configPath: '.crush.json',
      format: 'json',
      serversKey: 'mcp',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'http',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
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
      defaultMcpFallbackPath: '.cursor/mcp.json',
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
    pluginProviderId: 'cursor',
    purgeStaleSubAgentMcp: true,
    hooks: {
      // Cursor reads hooks from a dedicated .cursor/hooks.json with a
      // { version: 1, hooks: { ... } } envelope.
      // Docs: https://cursor.com/docs/agent/hooks
      storage: {
        kind: 'standalone',
        configPath: '.cursor/hooks.json',
        format: 'json',
        envelope: 'cursor-v1',
      },
      shape: 'cursor',
      supportsNameTag: true,
      // Cursor's canonical/provider event surface (see
      // https://cursor.com/docs/agent/hooks). We map every canonical event
      // Cursor has a documented equivalent for; provider-only events (e.g.
      // `afterAgentResponse`, `workspaceOpen`, `beforeTabFileRead`) can be
      // targeted directly via `on: cursor:<eventName>`.
      eventMap: {
        sessionStart: { event: 'sessionStart' },
        sessionEnd: { event: 'sessionEnd' },
        beforeTool: { event: 'preToolUse' },
        afterTool: { event: 'postToolUse' },
        afterToolFailure: { event: 'postToolUseFailure' },
        beforeShell: { event: 'beforeShellExecution' },
        afterShell: { event: 'afterShellExecution' },
        beforeMcpCall: { event: 'beforeMCPExecution' },
        afterMcpCall: { event: 'afterMCPExecution' },
        beforeFileRead: { event: 'beforeReadFile' },
        afterFileEdit: { event: 'afterFileEdit' },
        userPromptSubmit: { event: 'beforeSubmitPrompt' },
        subagentStart: { event: 'subagentStart' },
        subagentStop: { event: 'subagentStop' },
        preCompact: { event: 'preCompact' },
        stop: { event: 'stop' },
      },
    },
  },
  droid: {
    id: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    detectInstalled: async () => existsSync(join(home, '.factory')),
    mcp: {
      configPath: '.factory/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'http',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.factory/droids',
      extension: '.md',
      format: 'markdown-frontmatter',
      fields: { model: 'inherit' },
    },
    // Droid documents `.factory-plugin/plugin.json` plugin manifests, but
    // capa has no parser for that schema. See the note on `augment`.
  },
  'gemini-cli': {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    detectInstalled: async () => existsSync(join(home, '.gemini')),
    mcp: {
      // Gemini settings is a regular JSON object with a top-level `mcpServers`.
      // We register the capa endpoint as `httpUrl` (streamable HTTP), not
      // `url` (SSE).
      configPath: '.gemini/settings.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'httpUrl',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.gemini/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
    hooks: {
      // Gemini CLI hooks live alongside its other settings in
      // .gemini/settings.json under a top-level `hooks` key. The shape
      // (matcher group + nested `hooks` array) mirrors Claude's, but the
      // event names and matcher conventions are Gemini-specific:
      //   - tool events are BeforeTool/AfterTool (not Pre/PostToolUse).
      //   - matcher is a regex over the tool name, where built-in tools
      //     are snake_case (run_shell_command, read_file, write_file, …)
      //     and MCP tools follow `mcp_<server>_<tool>`.
      // Events without a Gemini equivalent (`stop`) are simply omitted —
      // hooks targeting them are skipped with a one-shot warning.
      // Docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
      storage: {
        kind: 'inline-config',
        configPath: '.gemini/settings.json',
        format: 'json',
        hooksKey: 'hooks',
      },
      shape: 'gemini',
      supportsNameTag: true,
      eventMap: {
        sessionStart: { event: 'SessionStart' },
        sessionEnd: { event: 'SessionEnd' },
        userPromptSubmit: { event: 'BeforeAgent' },
        beforeTool: { event: 'BeforeTool' },
        afterTool: { event: 'AfterTool' },
        beforeShell: { event: 'BeforeTool', matcherPrefix: 'run_shell_command' },
        afterShell: { event: 'AfterTool', matcherPrefix: 'run_shell_command' },
        beforeFileRead: { event: 'BeforeTool', matcherPrefix: 'read_file' },
        afterFileEdit: {
          event: 'AfterTool',
          matcherPrefix: 'write_file|replace|edit_file',
        },
        beforeMcpCall: { event: 'BeforeTool', matcherPrefix: 'mcp_.*' },
        afterMcpCall: { event: 'AfterTool', matcherPrefix: 'mcp_.*' },
        preCompact: { event: 'PreCompress' },
      },
    },
  },
  'github-copilot': {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.github')) || existsSync(join(home, '.copilot')),
    mcp: {
      configPath: '.vscode/mcp.json',
      format: 'json',
      serversKey: 'servers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'http',
      supportsSubAgentEntries: false,
    },
    instructions: { filename: '.github/copilot-instructions.md' },
    rules: {
      dir: '.github/instructions',
      extension: '.instructions.md',
      frontmatter: 'yaml',
      fieldMap: { appliesTo: 'applyTo' },
    },
    subagents: {
      dir: '.github/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
  },
  goose: {
    id: 'goose',
    displayName: 'Goose',
    skillsDir: '.goose/skills',
    globalSkillsDir: join(configHome, 'goose/skills'),
    detectInstalled: async () => existsSync(join(configHome, 'goose')),
    // MCP is global-only (~/.config/goose/config.yaml); no project-local file.
    instructions: { filename: 'AGENTS.md' },
  },
  junie: {
    id: 'junie',
    displayName: 'Junie',
    skillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    detectInstalled: async () => existsSync(join(home, '.junie')),
    // Junie's native remote-HTTP schema is undocumented; this bare { url } entry is unverified.
    mcp: {
      configPath: '.junie/mcp/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.junie/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
  },
  'iflow-cli': {
    id: 'iflow-cli',
    displayName: 'iFlow CLI',
    skillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    detectInstalled: async () => existsSync(join(home, '.iflow')),
    mcp: {
      configPath: '.iflow/settings.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'httpUrl',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
  },
  kilo: {
    id: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    detectInstalled: async () => existsSync(join(home, '.kilocode')),
    // Kilo is mid-rename `.kilocode/` → `.kilo/`. The legacy MCP path is
    // still loaded by current Kilo releases.
    mcp: {
      configPath: '.kilocode/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'streamable-http',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    rules: {
      dir: '.kilo/rules',
      extension: '.md',
      frontmatter: 'none',
    },
    subagents: {
      dir: '.kilo/agent',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
  },
  'kimi-cli': {
    id: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.config/agents/skills'),
    detectInstalled: async () => existsSync(join(home, '.kimi')),
    // MCP is global-only (~/.kimi/mcp.json); no project-local file.
    instructions: { filename: 'AGENTS.md' },
  },
  'kiro-cli': {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    detectInstalled: async () => existsSync(join(home, '.kiro')),
    mcp: {
      configPath: '.kiro/settings/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    rules: {
      // Kiro calls these "steering" files. The inclusion-mode frontmatter
      // field name (`inclusion`?) is not 100% confirmed from public docs;
      // we emit the rules without frontmatter and let users add per-file
      // inclusion manually until verified.
      dir: '.kiro/steering',
      extension: '.md',
      frontmatter: 'none',
    },
  },
  kode: {
    id: 'kode',
    displayName: 'Kode',
    skillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    detectInstalled: async () => existsSync(join(home, '.kode')),
    mcp: {
      configPath: '.mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'http',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.kode/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
    // Kode plugins live at `.kode-plugin/plugin.json` (with a legacy
    // `.claude-plugin/` fallback in some repos). The new schema isn't
    // covered by capa's Claude or Cursor parsers, so we don't declare Kode
    // as a plugin source yet. Plugins shipping the legacy
    // `.claude-plugin/plugin.json` are already discoverable via the
    // claude-code entry.
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
    // MCP lives in `.vibe/config.toml` as TOML array-of-tables
    // (`[[mcp_servers]]`), which doesn't fit the current
    // `serversKey: <map>` model — held until McpIntegration supports it.
    instructions: { filename: 'AGENTS.md' },
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
    mcp: {
      configPath: 'opencode.json',
      format: 'json',
      serversKey: 'mcp',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'remote',
      entryExtraFields: { enabled: true },
      supportsSubAgentEntries: true,
      // OpenCode auto-exposes every entry under top-level `mcp` to all
      // primary agents (Build, Plan, …). Without this fence each
      // `capa-<id>` MCP — meant for one sub-agent — pollutes the main
      // session with sub-agent-only tool blocks. Pattern intentionally
      // does NOT match the bare main `capa_*` tools.
      // Docs: https://opencode.ai/docs/mcp-servers/#per-agent
      subAgentScopeFence: {
        key: 'permission',
        pattern: 'capa-*_*',
        value: 'deny',
      },
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.opencode/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
      fields: { mode: 'subagent' },
      // Re-allow the sub-agent's own MCP tools after the global fence.
      perAgentToolScope: {
        key: 'permission',
        patternTemplate: 'capa-{id}_*',
        value: 'allow',
      },
    },
  },
  openhands: {
    id: 'openhands',
    displayName: 'OpenHands',
    skillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    detectInstalled: async () => existsSync(join(home, '.openhands')),
    // MCP is global-only (~/.openhands/mcp.json); no project-local file.
    instructions: { filename: 'AGENTS.md' },
  },
  pi: {
    id: 'pi',
    displayName: 'Pi',
    skillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    detectInstalled: async () => existsSync(join(home, '.pi/agent')),
    // Core Pi has no project-local MCP; community extensions add one.
    instructions: { filename: 'AGENTS.md' },
  },
  qoder: {
    id: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    detectInstalled: async () => existsSync(join(home, '.qoder')),
    // MCP servers are managed via the IDE UI; no project-local file.
    instructions: { filename: 'AGENTS.md' },
    rules: {
      // Per-rule behavior (always/specific-files/model-decision/manual) is
      // selected via the Qoder IDE, not YAML frontmatter, so we emit plain
      // markdown rule files.
      dir: '.qoder/rules',
      extension: '.md',
      frontmatter: 'none',
    },
    subagents: {
      dir: '.qoder/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
  },
  'qwen-code': {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    skillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    detectInstalled: async () => existsSync(join(home, '.qwen')),
    mcp: {
      configPath: '.qwen/settings.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'httpUrl',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    subagents: {
      dir: '.qwen/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
  },
  replit: {
    id: 'replit',
    displayName: 'Replit',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    showInUniversalList: false,
    detectInstalled: async () => existsSync(join(process.cwd(), '.agents')),
    // Replit Agent reads `replit.md` only (not AGENTS.md). MCP is added
    // through the Integrations page (per-account, not per-project).
    instructions: { filename: 'replit.md' },
  },
  roo: {
    id: 'roo',
    displayName: 'Roo Code',
    skillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    detectInstalled: async () => existsSync(join(home, '.roo')),
    mcp: {
      configPath: '.roo/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'streamable-http',
      supportsSubAgentEntries: true,
    },
  },
  trae: {
    id: 'trae',
    displayName: 'Trae',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    detectInstalled: async () => existsSync(join(home, '.trae')),
    // Trae reads `.trae/mcp.json` only when the user toggles
    // Settings → Agents → Read project MCP config.
    mcp: {
      configPath: '.trae/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    rules: {
      dir: '.trae/rules',
      extension: '.md',
      frontmatter: 'none',
    },
  },
  'trae-cn': {
    id: 'trae-cn',
    displayName: 'Trae CN',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    detectInstalled: async () => existsSync(join(home, '.trae-cn')),
    mcp: {
      configPath: '.trae/mcp.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'AGENTS.md' },
    rules: {
      dir: '.trae/rules',
      extension: '.md',
      frontmatter: 'none',
    },
  },
  windsurf: {
    id: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    detectInstalled: async () => existsSync(join(home, '.codeium/windsurf')),
    rules: {
      dir: '.windsurf/rules',
      extension: '.md',
      frontmatter: 'yaml',
      fieldMap: {
        description: 'description',
        appliesTo: 'globs',
        alwaysApply: 'trigger',
        alwaysApplyValues: { trueValue: 'always_on', falseValue: 'model_decision' },
      },
    },
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
    mcp: {
      configPath: '.neovate/config.json',
      format: 'json',
      serversKey: 'mcpServers',
      serverKey: 'capa',
      entryUrlKey: 'url',
      entryType: 'http',
      supportsSubAgentEntries: true,
    },
    // No project-root instructions file documented for Neovate.
    // Sub-agents are registered through TypeScript plugin code, not files.
  },
  pochi: {
    id: 'pochi',
    displayName: 'Pochi',
    skillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    detectInstalled: async () => existsSync(join(home, '.pochi')),
    mcp: {
      // `.pochi/config.jsonc` is JSONC; capa writes vanilla JSON which
      // JSONC parses fine. Top-level key is `mcp`, not `mcpServers`.
      configPath: '.pochi/config.jsonc',
      format: 'json',
      serversKey: 'mcp',
      serverKey: 'capa',
      entryUrlKey: 'url',
      supportsSubAgentEntries: true,
    },
    instructions: { filename: 'README.pochi.md' },
    subagents: {
      dir: '.pochi/agents',
      extension: '.md',
      format: 'markdown-frontmatter',
    },
  },
  adal: {
    id: 'adal',
    displayName: 'AdaL',
    skillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    detectInstalled: async () => existsSync(join(home, '.adal')),
    // MCP is CLI-managed (`/mcp add` at runtime); no project-local file.
    instructions: { filename: 'AGENTS.md' },
  },
};
