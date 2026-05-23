# Antigravity (`antigravity`)

> **Status:** Partial integration  
> **Skills dir:** `.agent/skills/` (global: `~/.gemini/antigravity/skills`)  
> **Docs root:** <https://docs.antigravity.google/>

Source-of-truth definition: [`src/shared/providers/registry.ts → antigravity`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agent/skills/<id>/` | — |
| MCP | — *(held back)* | The Antigravity **IDE** has no project-local MCP file (global only at `~/.gemini/antigravity/mcp_config.json`). The **CLI** does expose `.agents/mcp_config.json`, but uses `serverUrl` (not `url`). Capa declines to write either path until we split off `antigravity-cli` or extend `McpIntegration` to support `entryUrlKey: 'serverUrl'`. |
| Instructions | `AGENTS.md` | Antigravity also reads `GEMINI.md`. |
| Rules | `.agents/rules/<id>.md` | Plain markdown, no frontmatter. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- IDE vs CLI build divergence on MCP. If we add `entryUrlKey: 'serverUrl'`
  support, surface that the CLI is what reads `.agents/mcp_config.json`
  — the IDE never will.

## Sources

- Antigravity docs: <https://docs.antigravity.google/>

Last verified: 2026-05-23
