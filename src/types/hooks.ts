/**
 * Hook types — declarative lifecycle hooks installed across providers.
 *
 * Each `Hook` declared in the capabilities file is translated to one or more
 * provider-specific entries by `installHooks()`. capa keeps a per-entry
 * record (`managed_hooks`) so install/clean can edit shared config files
 * (e.g. `.claude/settings.json`) without disturbing user-authored entries.
 */

import type { AgentSnippetDef } from './capabilities';

/**
 * Canonical lifecycle events.
 *
 * `installHooks()` translates each canonical event to the provider's native
 * event name via `HooksIntegration.eventMap`. Providers that don't expose an
 * equivalent event simply skip the hook for that target (warn-but-never-fail).
 */
export type CanonicalHookEvent =
  | 'sessionStart'
  | 'sessionEnd'
  | 'userPromptSubmit'
  | 'beforeTool'
  | 'afterTool'
  | 'afterToolFailure'
  | 'beforeShell'
  | 'afterShell'
  | 'beforeFileRead'
  | 'afterFileEdit'
  | 'beforeMcpCall'
  | 'afterMcpCall'
  | 'subagentStart'
  | 'subagentStop'
  | 'preCompact'
  | 'stop';

export const CANONICAL_HOOK_EVENTS: readonly CanonicalHookEvent[] = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'beforeTool',
  'afterTool',
  'afterToolFailure',
  'beforeShell',
  'afterShell',
  'beforeFileRead',
  'afterFileEdit',
  'beforeMcpCall',
  'afterMcpCall',
  'subagentStart',
  'subagentStop',
  'preCompact',
  'stop',
];

/**
 * Source of the hook payload (script body or prompt text).
 *
 *   - `inline`  : `content` is the literal body
 *   - `remote`  : `url` is fetched at install time
 *   - `github`  : `def.repo` follows the same grammar as skills/snippets
 *   - `gitlab`  : like `github` but for GitLab projects
 *   - `local`   : `path` is read from disk (relative to the capabilities file)
 *
 * For `command`-type hooks the resolved body is materialised under
 * `~/.capa/hooks/{projectId}/{hook-id}` so projects stay clean. The provider
 * config entry then references that absolute path. For `prompt`-type hooks
 * the body is sent inline (no file is materialised).
 */
export interface HookSource {
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local';
  content?: string;
  url?: string;
  def?: AgentSnippetDef;
  path?: string;
  /** When true (default) the materialised script is chmod +x. */
  executable?: boolean;
}

/**
 * Provider-namespaced event names — `"claude-code:PreToolUse"`. Used as the
 * `on:` value when a hook is intentionally provider-specific (and not part of
 * the canonical set). The first segment is matched case-insensitively against
 * a provider id; the second segment is passed through verbatim.
 */
export type ProviderScopedEvent = `${string}:${string}`;

/**
 * A single declarative hook entry.
 *
 * Either `command` (default) or `type: 'prompt'` is required. Either
 * `command` (for command-type) or `prompt` (for prompt-type) must be set,
 * unless `source` is provided to materialise the script body from elsewhere.
 */
export interface Hook {
  /** Stable id, used for managed-state tracking and `name: capa:<id>` tags. */
  id: string;
  /** Human-readable description. */
  description?: string;

  /** Canonical event name, or `<provider>:<event>` for provider-only events. */
  on: CanonicalHookEvent | ProviderScopedEvent;

  /** `command` (shell) or `prompt` (text injected into the model). Default `command`. */
  type?: 'command' | 'prompt';

  /** Inline shell command. Required when `type` is `command` and `source` is unset. */
  command?: string;
  /** Inline prompt text. Required when `type` is `prompt` and `source` is unset. */
  prompt?: string;

  /** Provider-specific tool/glob filter (e.g. Claude `matcher`, Cursor `pattern`). */
  matcher?: string;
  /** Per-hook timeout in seconds. Provider may clamp or ignore. */
  timeout?: number;
  /** When true the provider should fail the action if the hook errors. */
  failClosed?: boolean;
  /** When true the provider runs hooks one-at-a-time (default: parallel). */
  sequential?: boolean;

  /** When set, only install for these provider ids. Empty/omitted = all providers. */
  providers?: string[];

  /** Optional alternate body source (overrides `command`/`prompt`). */
  source?: HookSource;
}
