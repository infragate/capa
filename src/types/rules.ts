import type { AgentSnippetDef } from './capabilities';

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
}
