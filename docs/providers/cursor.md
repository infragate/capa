# Cursor (`cursor`)

> **Status:** Full integration  
> **Skills dir:** `.cursor/skills/` (global: `~/.cursor/skills`)  
> **Docs root:** <https://docs.cursor.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → cursor`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.cursor/skills/<id>/` | — |
| MCP | `.cursor/mcp.json` → `mcpServers.capa.url` | **Does not** support sub-agent entries (`supportsSubAgentEntries: false`); capa sets `purgeStaleSubAgentMcp: true` to strip leftover `capa-*` keys. |
| Instructions | `AGENTS.md` | — |
| Rules | `.cursor/rules/<id>.mdc` | YAML frontmatter: `description`, `globs` (from capa's `appliesTo`), `alwaysApply`. |
| Sub-agents | `.cursor/agents/<id>.md` | Markdown + frontmatter (`model`, `readonly`, `is_background`). |
| Hooks | `.cursor/hooks.json` (standalone) | `{ version: 1, hooks: { <eventName>: [ { name: "capa:<id>", command, … } ] } }` envelope. Supports both command-based hooks (`command`) and prompt-based, LLM-evaluated hooks (`type: "prompt"` + `prompt`). Cursor lets a hook fail-close on a non-zero exit (`failClosed: true`). |
| Plugin manifests | `.cursor-plugin/plugin.json` (`pluginProviderId: cursor`) | Parsed by `parseCursorManifest` — see [plugin docs](../README.md#plugin-discovery-and-unpack). |

## Hooks event mapping

Canonical → Cursor: `sessionStart → sessionStart`, `sessionEnd → sessionEnd`,
`beforeTool → preToolUse`, `afterTool → postToolUse`,
`afterToolFailure → postToolUseFailure`, `beforeShell → beforeShellExecution`,
`afterShell → afterShellExecution`, `beforeFileRead → beforeReadFile`,
`afterFileEdit → afterFileEdit`, `beforeMcpCall → beforeMCPExecution`,
`afterMcpCall → afterMCPExecution`, `userPromptSubmit → beforeSubmitPrompt`,
`subagentStart → subagentStart`, `subagentStop → subagentStop`,
`preCompact → preCompact`, `stop → stop`. Cursor-only events (e.g.
`afterAgentResponse`, `workspaceOpen`, `beforeTabFileRead`) can be
targeted directly with `on: cursor:<eventName>` to bypass the canonical
map.

## Sources

- Cursor docs: <https://docs.cursor.com/>
- Cursor hooks reference: <https://cursor.com/docs/agent/hooks>

Last verified: 2026-05-24
