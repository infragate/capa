import type { AgentSnippetDef } from './capabilities';
import type { SourcePlugin } from './plugin';

export type RulePlacementPolicy = 'strict' | 'best-effort';

/**
 * A rule to install across providers.
 *
 * For providers that have a dedicated rules directory (e.g. Cursor `.cursor/rules/`),
 * each rule is written as a separate file with optional YAML frontmatter.
 *
 * For providers without a rules directory (e.g. Claude Code, Codex), the rule
 * content is folded into the provider's instructions file as a capa marker block.
 */
export interface Rule {
  /** Unique identifier, used as the filename stem and capa marker id. */
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local';
  /** Restrict this rule to specific providers. When empty/omitted, applies to all. */
  providers?: string[];
  /** Glob patterns for auto-attached rules (Cursor `globs`, Copilot `applyTo`). */
  appliesTo?: string[];
  /** Human-readable description (used in frontmatter for Cursor, Copilot). */
  description?: string;
  /** When true, the rule is always loaded regardless of file context (Cursor `alwaysApply`). */
  alwaysApply?: boolean;
  /**
   * `strict` (default): report a conflict when a shared instructions file
   * would expose this rule to a provider excluded by `providers`.
   * `best-effort`: accept that other readers of the shared file see it.
   */
  visibility?: RulePlacementPolicy;
  /**
   * `strict` (default): report a conflict when `appliesTo` can't be
   * represented natively for a provider that folds rules into its
   * instructions file. `best-effort`: fold at the root with an
   * "Applies to" preamble.
   */
  scope?: RulePlacementPolicy;
  /** Literal content (required when type is 'inline'). */
  content?: string;
  /** Raw URL to fetch content from (required when type is 'remote'). */
  url?: string;
  /**
   * Path to a local markdown file (required when type is 'local'). Relative
   * paths are resolved from the directory containing the capabilities file.
   */
  path?: string;
  /** Repository + file definition (required when type is 'github' or 'gitlab'). */
  def?: AgentSnippetDef;
  /** Set when this rule was unpacked from a plugin. */
  sourcePlugin?: SourcePlugin;
}
