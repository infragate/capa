# Codex (`codex`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `$CODEX_HOME/skills`)  
> **Docs root:** <https://github.com/openai/codex>

Source-of-truth definition: [`src/shared/providers/registry.ts → codex`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.codex/config.toml` → `mcp_servers.capa.url` | **TOML** map. Supports per-sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; capa writes marker blocks into the instructions file. |
| Sub-agents | `.codex/agents/<id>.toml` | TOML format; body goes into the `developer_instructions` field. |
| Hooks | `.codex/config.toml` → `[hooks]` | Matcher-grouped Claude-style layout (`[[hooks.<Event>]]` + nested `[[hooks.<Event>.hooks]]`), serialised as TOML. Capa appends an opaque `name = "capa:<hookId>"` field on entries it owns; Codex's TOML deserialiser ignores unknown fields, so the tag round-trips cleanly and capa uses it for surgical updates without disturbing user-authored entries. |
| Plugin manifests | — | Not declared; Codex consumes plugins via the same Claude/Cursor manifest paths handled elsewhere. |

## Hooks event mapping

Codex uses Claude-style event names plus a tool-name matcher; built-in
tools include `Bash` and `apply_patch`, and MCP tools follow the
`mcp__server__tool` pattern. Canonical → Codex:
`sessionStart → SessionStart`, `userPromptSubmit → UserPromptSubmit`,
`beforeTool → PreToolUse`, `afterTool → PostToolUse`,
`beforeShell → PreToolUse` + `matcher: Bash`,
`afterShell → PostToolUse` + `matcher: Bash`,
`afterFileEdit → PostToolUse` + `matcher: apply_patch`,
`beforeMcpCall → PreToolUse` + `matcher: mcp__`,
`afterMcpCall → PostToolUse` + `matcher: mcp__`,
`subagentStart → SubagentStart`, `subagentStop → SubagentStop`,
`preCompact → PreCompact`, `stop → Stop`. Codex does not expose a
`sessionEnd` or `beforeFileRead` equivalent — those canonical hooks are
skipped on Codex with a one-shot warning. Codex-specific events (e.g.
`PermissionRequest`, `PostCompact`) can be targeted directly with
`on: codex:<EventName>`.

## TOML layout

Codex's hook config uses the same matcher-grouped envelope Claude uses,
serialised as TOML's nested array of tables. A capa-managed
`beforeShell` hook lands as:

```toml
[[hooks.PreToolUse]]
matcher = "Bash"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "/abs/path/to/script"
name = "capa:audit-shell"
timeout = 5
```

The `name` field is capa's opaque entry tag (`capa:<hookId>`). Codex's
deserialiser (see
[`codex-rs/config/src/hook_config.rs`](https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs))
does not use `#[serde(deny_unknown_fields)]` on `MatcherGroup` or
`HookHandlerConfig`, so the tag is silently ignored at runtime but
preserved across writes — capa relies on it to find and update or
remove its own entries without touching user-authored siblings in the
same matcher group.

## Sources

- Codex repo & config docs: <https://github.com/openai/codex>
- Codex hooks guide: <https://developers.openai.com/codex/hooks>
- Codex hooks deserialiser: <https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs>

Last verified: 2026-05-24
