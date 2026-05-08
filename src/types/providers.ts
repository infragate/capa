/**
 * How to register capa's MCP server with a provider's configuration file.
 * All fields are pure data — no functions.
 */
export interface McpIntegration {
  /** Config file path relative to project root (e.g. '.cursor/mcp.json'). */
  configPath: string;
  /** File format used by this provider's MCP config. */
  format: 'json' | 'toml';
  /** Top-level key that holds the server map (e.g. 'mcpServers', 'mcp_servers', 'servers'). */
  serversKey: string;
  /** Key used for capa's main entry (usually 'capa'). */
  serverKey: string;
  /** The key inside the server entry that holds the URL (e.g. 'url'). */
  entryUrlKey: string;
  /** Whether per-sub-agent MCP entries ('capa-{id}') can coexist with the main entry. */
  supportsSubAgentEntries: boolean;
}

/**
 * Where the provider reads its agent-instructions file (AGENTS.md, CLAUDE.md, etc.).
 */
export interface InstructionsIntegration {
  /** Filename relative to project root. */
  filename: string;
}

/**
 * Where the provider reads per-rule files.
 */
export interface RulesIntegration {
  /** Directory relative to project root (e.g. '.cursor/rules'). */
  dir: string;
  /** File extension including the dot (e.g. '.mdc', '.md', '.instructions.md'). */
  extension: string;
  /** Whether a YAML frontmatter block is expected. */
  frontmatter: 'yaml' | 'none';
  /**
   * Maps rule fields to the provider's frontmatter key names.
   * Only relevant when frontmatter is 'yaml'.
   * e.g. { description: 'description', appliesTo: 'globs', alwaysApply: 'alwaysApply' }
   */
  fieldMap?: {
    description?: string;
    appliesTo?: string;
    alwaysApply?: string;
    /**
     * Optional value mapping for the alwaysApply field.
     * When present, `true` emits `trueValue` and `false`/undefined emits `falseValue`.
     * e.g. Windsurf: { trueValue: 'always_on', falseValue: 'model_decision' }
     */
    alwaysApplyValues?: { trueValue: string; falseValue: string };
  };
}

/**
 * Where the provider reads sub-agent definition files.
 */
export interface SubagentsIntegration {
  /** Directory relative to project root (e.g. '.cursor/agents'). */
  dir: string;
  /** File extension including the dot (e.g. '.md', '.toml'). */
  extension: string;
  /** File body format. */
  format: 'markdown-frontmatter' | 'toml';
  /** Static fields to include in the frontmatter (markdown) or top-level (toml). */
  fields?: Record<string, string | boolean | number>;
  /** For TOML format: the key name used for the body text (e.g. 'developer_instructions'). */
  bodyField?: string;
}

/**
 * Complete per-provider integration manifest. The single source of truth for
 * both skill-directory paths (ported from vercel-labs/skills) and CAPA-owned
 * integration points (MCPs, instructions, rules, subagents, plugins).
 *
 * All fields are pure data — no functions except the optional detectInstalled
 * callback. For providers we don't fully integrate yet, only the skill-path
 * fields are populated; the optional integration fields remain undefined.
 */
export interface ProviderIntegration {
  /** Provider id, matches entries in capabilities.providers[]. */
  id: string;
  /** Human-readable name shown in CLI output. */
  displayName: string;

  /** Project-local skills directory relative to project root (e.g. '.cursor/skills'). */
  skillsDir: string;
  /** Global (user-level) skills directory. Undefined if provider doesn't support global skills. */
  globalSkillsDir?: string;
  /** Detect whether this provider is installed on the system. */
  detectInstalled?: () => Promise<boolean>;
  /** When false, exclude from the universal-agents listing (e.g. replit). */
  showInUniversalList?: boolean;

  /** MCP server registration. Undefined if capa doesn't register MCPs for this provider yet. */
  mcp?: McpIntegration;
  /** Agent-instructions file management. */
  instructions?: InstructionsIntegration;
  /** Per-rule file management. */
  rules?: RulesIntegration;
  /** Sub-agent file management. */
  subagents?: SubagentsIntegration;
  /** Plugin manifest paths relative to the plugin repo root (e.g. '.cursor-plugin/plugin.json'). */
  pluginManifestPaths?: string[];
}
