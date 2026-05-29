# Gemini CLI (`gemini-cli`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `~/.gemini/skills`)  
> **Docs root:** <https://github.com/google-gemini/gemini-cli>

Source-of-truth definition: [`src/shared/providers/registry.ts → gemini-cli`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.gemini/settings.json` → `mcpServers.capa.httpUrl` | **Note `httpUrl`** (streamable HTTP), not `url` (SSE). Supports sub-agent entries. |
| Instructions | `AGENTS.md` | Supported via configurable `context.fileName`. |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.gemini/agents/<id>.md` | Markdown + YAML frontmatter; `name` / `description` required. |
| Hooks | `.gemini/settings.json` → `hooks` | JSON map; Gemini reuses the Claude shape, so capa upserts `[{ matcher, hooks: [{ name: "capa:<id>", … }] }]` and only manages its own tagged entries. |
| Plugin manifests | — | Not declared. |

## Hooks event mapping

Canonical → Gemini: `sessionStart → SessionStart`, `sessionEnd → SessionEnd`,
`userPromptSubmit → BeforeAgent`, `beforeTool → BeforeTool`,
`afterTool → AfterTool`, `beforeShell → BeforeTool` + `matcher: run_shell_command`,
`afterShell → AfterTool` + `matcher: run_shell_command`,
`beforeFileRead → BeforeTool` + `matcher: read_file`,
`afterFileEdit → AfterTool` + `matcher: write_file|replace|edit_file`,
`beforeMcpCall → BeforeTool` + `matcher: mcp_.*`,
`afterMcpCall → AfterTool` + `matcher: mcp_.*`, `preCompact → PreCompress`.
Gemini does not expose a `Stop` equivalent, so canonical `stop` hooks are
skipped on this provider with a one-shot warning. Gemini-only events
(e.g. `BeforeToolSelection`, `BeforeModel`, `AfterModel`, `Notification`)
can be targeted directly with `on: gemini-cli:<EventName>`.

## Caveats

- Capa registers as `httpUrl` (streamable HTTP), not `url` (SSE). Don't
  accidentally regress that — the two transports are not interchangeable.

## Sources

- Gemini CLI repo: <https://github.com/google-gemini/gemini-cli>
- Gemini CLI hooks (`.gemini/settings.json` → `hooks`): <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md#hooks>

Last verified: 2026-05-24
