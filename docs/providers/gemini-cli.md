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
| Instructions | `AGENTS.md`, or `GEMINI.md` when isolated | `AGENTS.md` when Gemini is the only active provider reading it; otherwise capa generates `GEMINI.md` (see [Shared instruction files](#shared-instruction-files)). Capa merges the chosen file into `.gemini/settings.json` → `context.fileName`. |
| Rules | folded into the instructions file | No project-local rules directory; rules become marker blocks. Directory `appliesTo` globs go to nested `dir/AGENTS.md` / `dir/GEMINI.md`. |
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

## Shared instruction files

Gemini reads `GEMINI.md` by default and any extra names listed in
`context.fileName`. Other providers (Codex, Cursor, OpenCode, …) read
`AGENTS.md`, so a rule restricted to one of them would leak into Gemini if
Gemini read the same file. The layout depends only on `providers`:

| Active providers | Gemini reads | `context.fileName` entry capa adds |
| --- | --- | --- |
| Gemini is the only `AGENTS.md` reader | `AGENTS.md` | `AGENTS.md` (an absent setting becomes `["GEMINI.md", "AGENTS.md"]` so an existing `GEMINI.md` keeps loading) |
| Another provider also reads `AGENTS.md` | generated `GEMINI.md` (agent snippets + rules Gemini may see) | `GEMINI.md`, only when the setting exists without it (it's Gemini's default) |

Capa appends to an existing `context.fileName` (string or list) without
touching other entries or settings, and records the values it added under
`providerConfig` in `capabilities.lock`. `capa clean` (and removing
`gemini-cli` from `providers`) removes only those values. If the user also
lists `AGENTS.md` while Gemini is isolated, capa leaves it and warns, since
Gemini would read rules targeted at other providers.

## Caveats

- Capa registers as `httpUrl` (streamable HTTP), not `url` (SSE). Don't
  accidentally regress that — the two transports are not interchangeable.

## Sources

- Gemini CLI repo: <https://github.com/google-gemini/gemini-cli>
- Gemini CLI hooks (`.gemini/settings.json` → `hooks`): <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md#hooks>

Last verified: 2026-05-24
