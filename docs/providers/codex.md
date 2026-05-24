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
| Hooks | `.codex/config.toml` → `[hooks]` | TOML tables. Codex does not support a `name` tag, so capa keys each entry by `id = "<hookId>"` and tracks `(event, hookId)` in `managed_hooks` for surgical updates. |
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

## Sources

- Codex repo & config docs: <https://github.com/openai/codex>
- Codex hooks (`config.toml` → `[hooks]`): <https://github.com/openai/codex/blob/main/docs/config.md#hooks>

Last verified: 2026-05-24
