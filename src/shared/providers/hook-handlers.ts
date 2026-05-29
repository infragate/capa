/**
 * Per-shape hook entry serialisers.
 *
 * Each shape ('claude', 'cursor', …) maps a (canonical event, hook payload,
 * matcher) tuple to a JSON-friendly fragment that lives inside the provider's
 * config file. Pure functions — no I/O, so they can be unit-tested without
 * a temp project.
 *
 * The companion `installer/io` layer (see `cli/utils/hooks-installer.ts`)
 * applies these fragments to the on-disk config and records a `locator`
 * back so the next install/clean run can find and remove the same entry.
 */

import { join } from "path";
import type { Hook } from "../../types/hooks";
import type {
  HooksIntegration,
  ProviderEventMapping,
} from "../../types/providers";

/**
 * The bag of inputs every shape serialiser needs.
 * `runReference` is either an absolute path (for `command`-type hooks
 * whose body has been materialised under ~/.capa) or the literal command
 * string when the user passed `command:` inline.
 */
export interface HookEntryInput {
  hook: Hook;
  /** Shell command to execute, or prompt text for prompt-type hooks. */
  runReference: string;
  /** The mapping picked from `HooksIntegration.eventMap`. */
  mapping: ProviderEventMapping;
}

/**
 * The result of serialising one hook for one provider event.
 *
 *  - `eventName`  : the provider event name (e.g. 'PreToolUse')
 *  - `entry`      : the JSON fragment to drop into the hooks map
 *  - `matcher`    : the matcher under which the entry should be filed
 *                   (claude/gemini); empty string for shapes that don't
 *                   group by matcher
 *  - `nameTag`    : `capa:<hook-id>` when the shape supports name tagging,
 *                   else null. Used by the installer to find/replace the
 *                   exact entry on the next run.
 */
export interface HookEntryOutput {
  eventName: string;
  entry: Record<string, unknown>;
  matcher: string;
  nameTag: string | null;
}

const NAME_TAG_PREFIX = "capa:";

export function buildNameTag(hookId: string): string {
  return `${NAME_TAG_PREFIX}${hookId}`;
}

export function isCapaNameTag(value: unknown, hookId?: string): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith(NAME_TAG_PREFIX)) return false;
  if (hookId && value !== buildNameTag(hookId)) return false;
  return true;
}

function idFromNameTag(tag: string): string {
  return tag.startsWith(NAME_TAG_PREFIX)
    ? tag.slice(NAME_TAG_PREFIX.length)
    : tag;
}

/**
 * Pick a matcher value for the entry.
 *
 * `matcherPrefix` is the canonical event's implicit tool-family scope (e.g.
 * `beforeShell -> PreToolUse` is implicitly scoped to `Bash`). It MUST be
 * preserved when emitted, otherwise the canonical event silently widens to
 * every tool and breaks the documented contract.
 *
 * Behaviour:
 *  - prefix only            -> use prefix
 *  - user matcher only      -> use user matcher (no canonical scope to fold in)
 *  - both                   -> union them as a regex alternation
 *                              `(?:prefix)|(?:userMatcher)` so the
 *                              canonical tool family is still covered while
 *                              the user's extra tool names also fire. Each
 *                              side is wrapped in a non-capturing group so
 *                              alternations or anchors inside either the
 *                              registry prefix (e.g. `Edit|MultiEdit|Write`)
 *                              or a user matcher compose as a top-level
 *                              alternation, and so we don't introduce new
 *                              numbered capture groups that could collide
 *                              with backreferences in the user matcher.
 *                              The user can bypass this fold-in by switching
 *                              to the provider-scoped event form (e.g.
 *                              `on: claude-code:PreToolUse`).
 *  - neither                -> empty (shape decides)
 */
function resolveMatcher(input: HookEntryInput): string {
  const userMatcher =
    input.hook.matcher && input.hook.matcher.length > 0
      ? input.hook.matcher
      : "";
  const prefix =
    "matcherPrefix" in input.mapping ? input.mapping.matcherPrefix : "";
  if (prefix && userMatcher) {
    return prefix === userMatcher ? prefix : `(?:${prefix})|(?:${userMatcher})`;
  }
  return userMatcher || prefix;
}

// ---------------------------------------------------------------------------
// Shape serialisers
// ---------------------------------------------------------------------------

function buildClaudeLikeEntry(
  input: HookEntryInput,
  supportsName: boolean,
): HookEntryOutput {
  const { hook, mapping, runReference } = input;
  const isPrompt = (hook.type ?? "command") === "prompt";
  const entry: Record<string, unknown> = {
    type: isPrompt ? "prompt" : "command",
    [isPrompt ? "prompt" : "command"]: runReference,
  };
  if (hook.timeout !== undefined) entry.timeout = hook.timeout;
  const nameTag = supportsName ? buildNameTag(hook.id) : null;
  if (nameTag) entry.name = nameTag;
  return {
    eventName: mapping.event,
    entry,
    matcher: resolveMatcher(input),
    nameTag,
  };
}

function buildCursorEntry(input: HookEntryInput): HookEntryOutput {
  const { hook, mapping, runReference } = input;
  // Cursor supports two execution types: command-based (default) and
  // prompt-based (LLM-evaluated). A prompt entry uses `{ type: "prompt",
  // prompt: <text> }`; a command entry uses a bare `{ command: <path> }`
  // (no `type` field needed — command is Cursor's default).
  // Docs: https://cursor.com/docs/agent/hooks
  const isPrompt = (hook.type ?? "command") === "prompt";
  const entry: Record<string, unknown> = isPrompt
    ? { type: "prompt", prompt: runReference }
    : { command: runReference };
  const matcher = resolveMatcher(input);
  if (matcher) entry.pattern = matcher;
  if (hook.timeout !== undefined) entry.timeout = hook.timeout;
  if (hook.failClosed) entry.failClosed = true;
  const nameTag = buildNameTag(hook.id);
  entry.name = nameTag;
  return {
    eventName: mapping.event,
    entry,
    matcher: "",
    nameTag,
  };
}

/**
 * Build the shape-specific entry for a single (provider, hook, mapping).
 *
 * Throws when the shape is not handled by the installer (caller should
 * convert to a warning so install never fails on unknown shape).
 */
export function buildHookEntry(
  integration: HooksIntegration,
  input: HookEntryInput,
): HookEntryOutput {
  switch (integration.shape) {
    case "claude":
    case "gemini":
    case "antigravity":
    case "windsurf":
      return buildClaudeLikeEntry(input, integration.supportsNameTag);
    case "cursor":
      return buildCursorEntry(input);
    default:
      throw new Error(
        `Unsupported hook shape: ${(integration as { shape: string }).shape}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Locator / placement helpers
// ---------------------------------------------------------------------------

/**
 * Where (inside the parsed config object) capa stores its hook entry. The
 * locator round-trips through `managed_hooks.locator` so a future install
 * can find and remove the same entry surgically.
 *
 * Layout per shape (`hooksRoot` is the inline-config `hooksKey` or the bare
 * standalone document):
 *
 *  - claude/gemini/codex/windsurf/antigravity :
 *                    hooksRoot[<event>] is an array of `{ matcher, hooks: [entry] }`.
 *                    Codex serialises this as TOML's nested array of tables
 *                    (`[[hooks.PreToolUse]]` + `[[hooks.PreToolUse.hooks]]`),
 *                    every other provider as JSON; the layout is the same.
 *                    locator = ['<event>', <matcherIndex>, 'hooks', <entryIndex>]
 *  - cursor        : hooksRoot[<event>] is an array of `entry`.
 *                    locator = ['<event>', <entryIndex>]
 *
 * Locators are emitted relative to the hooks root, NOT relative to the file
 * — each shape has a `rootPath` helper for the absolute path, which the
 * installer uses when it loads the config.
 */
export type HookLocator = (string | number)[];

/**
 * Apply a built hook entry to the parsed hooks-root object, replacing any
 * previous capa entry with the same name tag (if the shape supports it).
 *
 * Mutates `hooksRoot` in place and returns the locator to record in the DB.
 */
export function upsertHookEntry(
  integration: HooksIntegration,
  hooksRoot: Record<string, unknown>,
  output: HookEntryOutput,
): HookLocator {
  switch (integration.shape) {
    case "claude":
    case "gemini":
    case "antigravity":
    case "windsurf": {
      const { eventName, entry, matcher, nameTag } = output;
      const events = ensureArray(hooksRoot, eventName);
      // Each element is `{ matcher: string, hooks: [{ … }] }`.
      let matcherIdx = events.findIndex(
        (g) => isPlainObject(g) && (g.matcher ?? "") === matcher,
      );
      if (matcherIdx === -1) {
        events.push({ matcher, hooks: [] });
        matcherIdx = events.length - 1;
      }
      const group = events[matcherIdx] as { matcher: string; hooks: unknown[] };
      if (!Array.isArray(group.hooks)) group.hooks = [];
      // Replace only the entry tagged for *this* hook id; other capa entries
      // for sibling hooks must coexist in the same matcher group.
      const existingIdx = nameTag
        ? group.hooks.findIndex(
            (e) =>
              isPlainObject(e) && isCapaNameTag(e.name, idFromNameTag(nameTag)),
          )
        : -1;
      if (existingIdx >= 0) {
        group.hooks[existingIdx] = entry;
        return [eventName, matcherIdx, "hooks", existingIdx];
      }
      group.hooks.push(entry);
      return [eventName, matcherIdx, "hooks", group.hooks.length - 1];
    }
    case "cursor": {
      const { eventName, entry, nameTag } = output;
      const events = ensureArray(hooksRoot, eventName);
      const existingIdx = nameTag
        ? events.findIndex(
            (e) =>
              isPlainObject(e) && isCapaNameTag(e.name, idFromNameTag(nameTag)),
          )
        : -1;
      if (existingIdx >= 0) {
        events[existingIdx] = entry;
        return [eventName, existingIdx];
      }
      events.push(entry);
      return [eventName, events.length - 1];
    }
    default:
      throw new Error(
        `Unsupported hook shape: ${(integration as { shape: string }).shape}`,
      );
  }
}

/**
 * Remove the entry at `locator` from the parsed hooks root.
 *
 * Returns true when something was removed. Empty matcher groups and empty
 * event arrays are pruned so re-installing a different set of hooks does
 * not leave stale skeletons behind.
 */
export function removeHookEntryAt(
  integration: HooksIntegration,
  hooksRoot: Record<string, unknown>,
  locator: HookLocator,
  expectedHookId: string,
): boolean {
  switch (integration.shape) {
    case "claude":
    case "gemini":
    case "antigravity":
    case "windsurf": {
      // ['<event>', matcherIdx, 'hooks', entryIdx]
      if (locator.length !== 4) return false;
      const [eventName, matcherIdx, , entryIdx] = locator;
      if (
        typeof eventName !== "string" ||
        typeof matcherIdx !== "number" ||
        typeof entryIdx !== "number"
      ) {
        return false;
      }
      const events = hooksRoot[eventName];
      if (
        !Array.isArray(events) ||
        matcherIdx < 0 ||
        matcherIdx >= events.length
      )
        return false;
      const group = events[matcherIdx];
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) return false;
      if (entryIdx < 0 || entryIdx >= group.hooks.length) return false;
      const candidate = group.hooks[entryIdx];
      if (
        !isPlainObject(candidate) ||
        !isCapaNameTag(candidate.name, expectedHookId)
      )
        return false;
      group.hooks.splice(entryIdx, 1);
      if (group.hooks.length === 0) events.splice(matcherIdx, 1);
      if (events.length === 0) delete hooksRoot[eventName];
      return true;
    }
    case "cursor": {
      // ['<event>', entryIdx]
      if (locator.length !== 2) return false;
      const [eventName, entryIdx] = locator;
      if (typeof eventName !== "string" || typeof entryIdx !== "number")
        return false;
      const events = hooksRoot[eventName];
      if (!Array.isArray(events) || entryIdx < 0 || entryIdx >= events.length)
        return false;
      const candidate = events[entryIdx];
      if (
        !isPlainObject(candidate) ||
        !isCapaNameTag(candidate.name, expectedHookId)
      )
        return false;
      events.splice(entryIdx, 1);
      if (events.length === 0) delete hooksRoot[eventName];
      return true;
    }
    default:
      return false;
  }
}

/**
 * Resolve the absolute path of the hook config file for a provider whose
 * hook integration uses a `standalone` or `inline-config` storage. Throws
 * for `directory` storage (callers handle that branch separately).
 */
export function getHookConfigPath(
  integration: HooksIntegration,
  projectPath: string,
): string {
  switch (integration.storage.kind) {
    case "standalone":
      return join(projectPath, integration.storage.configPath);
    case "inline-config":
      return join(projectPath, integration.storage.configPath);
    case "directory":
      throw new Error(
        "directory-storage hooks resolve per-entry, not per-file",
      );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureArray(obj: Record<string, unknown>, key: string): unknown[] {
  const existing = obj[key];
  if (Array.isArray(existing)) return existing;
  const next: unknown[] = [];
  obj[key] = next;
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
