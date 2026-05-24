/**
 * Runtime validators for the `hooks:` field of `capabilities.yaml`.
 *
 * The top-level capabilities parser keeps `hooks` as a loose
 * `Record<string, unknown>[]` so unknown future fields don't break older
 * capa versions. The installer narrows each entry through `validateHooks()`
 * — invalid hooks are skipped with a warning rather than aborting install.
 */

import type { CanonicalHookEvent, Hook, HookSource } from "../types/hooks";
import { CANONICAL_HOOK_EVENTS } from "../types/hooks";

const CANONICAL_EVENT_SET: ReadonlySet<string> = new Set<string>(
  CANONICAL_HOOK_EVENTS,
);

const KNOWN_SOURCE_TYPES: ReadonlySet<HookSource["type"]> = new Set([
  "inline",
  "remote",
  "github",
  "gitlab",
  "local",
]);

export interface HookValidationIssue {
  hookId: string | null;
  message: string;
}

export interface HookValidationResult {
  valid: Hook[];
  issues: HookValidationIssue[];
}

function isCanonical(event: string): event is CanonicalHookEvent {
  return CANONICAL_EVENT_SET.has(event);
}

function isProviderScopedEvent(event: string): boolean {
  // shape: `<provider>:<event>` — both segments must be non-empty.
  const colonIdx = event.indexOf(":");
  return colonIdx > 0 && colonIdx < event.length - 1;
}

function validateSource(
  raw: unknown,
  hookId: string,
): HookSource | { error: string } {
  if (raw === undefined) return { error: "missing source" };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: `hook "${hookId}" source must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (
    typeof type !== "string" ||
    !KNOWN_SOURCE_TYPES.has(type as HookSource["type"])
  ) {
    return {
      error: `hook "${hookId}" source.type must be one of inline/remote/github/gitlab/local`,
    };
  }
  const result: HookSource = { type: type as HookSource["type"] };
  if (typeof obj.content === "string") result.content = obj.content;
  if (typeof obj.url === "string") result.url = obj.url;
  if (typeof obj.path === "string") result.path = obj.path;
  if (obj.def && typeof obj.def === "object" && !Array.isArray(obj.def)) {
    const def = obj.def as Record<string, unknown>;
    if (typeof def.repo === "string") {
      result.def = { repo: def.repo };
    }
  }
  switch (result.type) {
    case "inline":
      if (!result.content)
        return {
          error: `hook "${hookId}" source.type=inline requires content`,
        };
      break;
    case "remote":
      if (!result.url)
        return { error: `hook "${hookId}" source.type=remote requires url` };
      break;
    case "github":
    case "gitlab":
      if (!result.def?.repo)
        return {
          error: `hook "${hookId}" source.type=${result.type} requires def.repo`,
        };
      break;
    case "local":
      if (!result.path)
        return { error: `hook "${hookId}" source.type=local requires path` };
      break;
  }
  return result;
}

/**
 * Narrow each raw `hooks[]` entry to a `Hook`. Invalid entries are reported
 * via `issues` so the caller can surface warnings, not failures.
 */
export function validateHooks(raw: unknown[]): HookValidationResult {
  const valid: Hook[] = [];
  const issues: HookValidationIssue[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push({ hookId: null, message: `hook[${i}] must be an object` });
      continue;
    }
    const obj = item as Record<string, unknown>;

    if (typeof obj.id !== "string" || obj.id.length === 0) {
      issues.push({
        hookId: null,
        message: `hook[${i}] is missing required 'id' field`,
      });
      continue;
    }
    if (seenIds.has(obj.id)) {
      issues.push({
        hookId: obj.id,
        message: `duplicate hook id "${obj.id}" — entries after the first are skipped`,
      });
      continue;
    }

    if (typeof obj.on !== "string" || obj.on.length === 0) {
      issues.push({
        hookId: obj.id,
        message: `hook "${obj.id}" requires non-empty 'on' field`,
      });
      continue;
    }
    if (!isCanonical(obj.on) && !isProviderScopedEvent(obj.on)) {
      issues.push({
        hookId: obj.id,
        message: `hook "${obj.id}" event "${obj.on}" is neither canonical nor of the form <provider>:<event>`,
      });
      continue;
    }

    const type: "command" | "prompt" =
      obj.type === "prompt" ? "prompt" : "command";

    let source: HookSource | undefined;
    if (obj.source !== undefined) {
      const result = validateSource(obj.source, obj.id);
      if ("error" in result) {
        issues.push({ hookId: obj.id, message: result.error });
        continue;
      }
      source = result;
    }

    const command = typeof obj.command === "string" ? obj.command : undefined;
    const prompt = typeof obj.prompt === "string" ? obj.prompt : undefined;

    if (!source) {
      if (type === "command" && !command) {
        issues.push({
          hookId: obj.id,
          message: `hook "${obj.id}" requires 'command' or 'source' for type=command`,
        });
        continue;
      }
      if (type === "prompt" && !prompt) {
        issues.push({
          hookId: obj.id,
          message: `hook "${obj.id}" requires 'prompt' or 'source' for type=prompt`,
        });
        continue;
      }
    }

    const hook: Hook = {
      id: obj.id,
      on: obj.on as Hook["on"],
      type,
    };
    if (typeof obj.description === "string") hook.description = obj.description;
    if (command) hook.command = command;
    if (prompt) hook.prompt = prompt;
    if (typeof obj.matcher === "string") hook.matcher = obj.matcher;
    if (typeof obj.timeout === "number") hook.timeout = obj.timeout;
    if (typeof obj.failClosed === "boolean") hook.failClosed = obj.failClosed;
    if (typeof obj.sequential === "boolean") hook.sequential = obj.sequential;
    if (Array.isArray(obj.providers)) {
      const providers = obj.providers.filter(
        (p): p is string => typeof p === "string",
      );
      if (providers.length > 0) hook.providers = providers;
    }
    if (source) hook.source = source;

    seenIds.add(obj.id);
    valid.push(hook);
  }

  return { valid, issues };
}
