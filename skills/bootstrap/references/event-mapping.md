# Hook event mapping

When discovering hooks in provider-specific files, translate the provider's event name to capa's canonical event before writing it into `capabilities.yaml`. Hooks whose provider event has no canonical mapping should be written using the `<provider>:<event>` override form so they continue to install for that provider only.

The canonical event list is owned by capa's provider registry. Treat this file as a snapshot — if a provider you're discovering uses an event not listed here, default to keeping the provider-scoped form rather than guessing a canonical name.

## Canonical events

| Canonical | Fires when |
|---|---|
| `sessionStart` | Agent session begins |
| `sessionEnd` | Agent session ends |
| `userPromptSubmit` | User submits a prompt to the agent |
| `beforeTool` | Before any tool call |
| `afterTool` | After any tool call completes successfully |
| `afterToolFailure` | After any tool call fails |
| `beforeShell` | Before a shell command runs (subset of `beforeTool` for shell-only) |
| `afterShell` | After a shell command runs |
| `beforeFileRead` | Before reading a file |
| `afterFileEdit` | After editing a file |
| `beforeMcpCall` | Before an MCP tool call |
| `afterMcpCall` | After an MCP tool call |
| `subagentStart` | A sub-agent task begins |
| `subagentStop` | A sub-agent task ends |
| `preCompact` | Before context compaction |
| `stop` | The agent stops (different from sessionEnd in some providers) |

## Provider event → canonical

### Claude Code (`.claude/settings.json` → `hooks`)

| Provider event | Canonical |
|---|---|
| `SessionStart` | `sessionStart` |
| `SessionEnd` | `sessionEnd` |
| `UserPromptSubmit` | `userPromptSubmit` |
| `PreToolUse` | `beforeTool` (or `beforeShell` if matcher is `Bash`/`Shell`; `beforeMcpCall` if matcher targets MCP tools) |
| `PostToolUse` | `afterTool` (same matcher logic — narrow to `afterShell`/`afterMcpCall` when applicable) |
| `Stop` | `stop` |
| `SubagentStop` | `subagentStop` |
| `PreCompact` | `preCompact` |
| `Notification` | (no canonical — keep as `claude-code:Notification`) |

### Cursor (`.cursor/hooks.json`)

| Provider event | Canonical |
|---|---|
| `beforeShellExecution` | `beforeShell` |
| `afterShellExecution` | `afterShell` |
| `beforeFileEdit` | (no exact canonical — use `cursor:beforeFileEdit`) |
| `afterFileEdit` | `afterFileEdit` |
| `beforeMcpCall` | `beforeMcpCall` |
| `afterMcpCall` | `afterMcpCall` |

### Codex (`.codex/config.toml` → `[hooks]`)

Codex events generally mirror Claude's casing (`PreToolUse`, `PostToolUse`, etc.). Apply the Claude mapping.

### Gemini (`.gemini/settings.json` → `hooks`)

Gemini follows the Claude shape. Apply the Claude mapping.

## Narrowing PreToolUse / PostToolUse

`PreToolUse` is fired for every tool. When a discovered hook has a `matcher` that's specific (`Bash`, `Shell`, `mcp__*`), prefer the narrower canonical name — it makes the intent obvious in `capabilities.yaml`:

- matcher matches shell tools only → `beforeShell` / `afterShell`
- matcher matches MCP tools only (e.g., `mcp__server__tool`) → `beforeMcpCall` / `afterMcpCall`
- matcher is `*` or absent or matches multiple categories → `beforeTool` / `afterTool`

When in doubt, keep `beforeTool` — capa will fan it out to every provider's "pre any tool" event.

## Inline command vs script file

- Single-line `command` (e.g. `'date >> ~/.capa/audit.log'`) → keep inline in the capabilities file under `command:`.
- Multi-line script, or `command` that's actually a path to a `.sh`/`.py`/`.js` file in the repo → move the script under `hooks/<id>.sh` and reference via `source: { type: local, path: ./hooks/<id>.sh }`. This is the version-controlled form; capa won't copy or chmod the file, so the user should make sure it's executable.
- Path to a script outside the repo → keep inline as a `command` pointing at the absolute path; warn the user that this won't be portable across machines.
