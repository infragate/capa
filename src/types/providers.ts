import type { CanonicalHookEvent } from './hooks';

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
  /** Transport discriminator written as the entry's `type` field, for providers that require it. */
  entryType?: string;
  /** Static fields merged into the server entry (e.g. { enabled: true }). */
  entryExtraFields?: Record<string, unknown>;
  /** Whether per-sub-agent MCP entries ('capa-{id}') can coexist with the main entry. */
  supportsSubAgentEntries: boolean;
  /** Fallback config path when the primary `configPath` doesn't exist. */
  defaultMcpFallbackPath?: string;
  /** Env var name that points to the provider's plugin root (e.g. `CURSOR_PLUGIN_ROOT`). */
  pluginRootEnvVar?: string;
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
 * One canonical→provider event mapping. Most providers use a simple rename
 * (`{ event: 'PreToolUse' }`), but some — e.g. Cursor — fold our `beforeShell`
 * onto the same event as `beforeTool` and disambiguate with a `matcherPrefix`.
 */
export type ProviderEventMapping =
  | { event: string }
  | { event: string; matcherPrefix: string };

/**
 * How a provider stores its hook configuration.
 *
 *   - `standalone`     : hook map lives in its own file
 *                        (e.g. Cursor `.cursor/hooks.json`).
 *   - `inline-config`  : hook map lives under a top-level key in a shared
 *                        settings file (e.g. Claude `.claude/settings.json` →
 *                        `hooks`, Codex `.codex/config.toml` → `hooks`).
 *   - `directory`      : one JSON file per hook in a directory.
 *
 * `envelope: 'cursor-v1'` triggers the `{ version: 1, hooks: { ... } }`
 * wrapper Cursor expects. Without it the file is the bare hooks map.
 */
export type HooksStorage =
  | {
      kind: 'standalone';
      configPath: string;
      format: 'json';
      envelope?: 'cursor-v1';
    }
  | {
      kind: 'inline-config';
      configPath: string;
      format: 'json' | 'toml';
      hooksKey: string;
    }
  | { kind: 'directory'; dir: string; extension: '.json' };

/**
 * Per-provider hooks integration descriptor.
 *
 * Pure data — every behavior is derived from these fields by the shared
 * `hooks-installer` and the per-shape entry serialisers in
 * `shared/providers/hook-handlers.ts`.
 */
export interface HooksIntegration {
  /** Where the provider reads its hook configuration. */
  storage: HooksStorage;
  /** Canonical → provider event name (subset is fine; missing events are skipped). */
  eventMap: Partial<Record<CanonicalHookEvent, ProviderEventMapping>>;
  /**
   * Selects the entry shape used to serialise hook entries. `claude` covers
   * every provider that uses the matcher-grouped layout (Claude Code, Gemini
   * CLI, Codex, Windsurf, Antigravity); the variant labels exist only as
   * future-proofing in case a provider diverges (e.g. extra fields). The
   * `cursor` shape is a flat array with `pattern`+`name` per entry.
   *
   * Codex serialises through the same `claude` shape; the storage format is
   * what makes it land as TOML rather than JSON.
   */
  shape: 'cursor' | 'claude' | 'gemini' | 'windsurf' | 'antigravity';
  /**
   * When true the provider entry carries an opaque `name` field (used by capa
   * for the `capa:<hook-id>` tag, allowing surgical updates without disturbing
   * user-authored entries).
   */
  supportsNameTag: boolean;
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
 * and parsePluginManifest callbacks. For providers we don't fully integrate yet,
 * only the skill-path fields are populated; the optional integration fields
 * remain undefined.
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
  /** Lifecycle-hook management. Undefined when capa doesn't install hooks for this provider. */
  hooks?: HooksIntegration;
  /** Plugin manifest paths relative to the plugin repo root (e.g. '.cursor-plugin/plugin.json'). */
  pluginManifestPaths?: string[];
  /** Id used in the `PluginProvider` union (manifest enum); decouples registry id from manifest id. */
  pluginProviderId?: string;
  /**
   * Opt-in per-provider plugin-manifest parser.
   * @returns `UnifiedPluginManifest` from `plugin-manifest.ts` (not imported here to avoid circular deps).
   */
  parsePluginManifest?: (repoRoot: string, data: unknown, manifestDir?: string) => unknown;
  /** When true, install command purges stale `capa-{id}` MCP entries (currently hardcoded to Cursor only). */
  purgeStaleSubAgentMcp?: boolean;
  /** When true, sub-agent text is folded into the `instructions.filename` file instead of separate sub-agent files. */
  foldSubAgentsIntoInstructions?: boolean;
}
