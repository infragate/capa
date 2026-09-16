# Antigravity (`antigravity`)

> **Status:** Partial integration  
> **Skills dir:** `.agents/skills/` (global: `~/.gemini/config/skills`)  
> **Docs root:** <https://antigravity.google/docs/>

Source-of-truth definition: [`src/shared/providers/registry.ts → antigravity`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | — |
| MCP | — *(held back)* | Antigravity reads `.agents/mcp_config.json` (global: `~/.gemini/config/mcp_config.json`), but remote servers must use `serverUrl` — `url` is not supported. Capa declines to write it until `McpIntegration` supports `entryUrlKey: 'serverUrl'`. |
| Instructions | `AGENTS.md` | Antigravity also reads `GEMINI.md`. |
| Rules | `.agents/rules/<id>.md` | Plain markdown, no frontmatter. The legacy `.agent/rules/` is still read. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- MCP needs `serverUrl` support before capa can register itself.

## Sources

- Skills: <https://antigravity.google/docs/skills/>
- Rules & workflows: <https://antigravity.google/docs/rules-workflows/>
- MCP: <https://antigravity.google/docs/mcp/>

Last verified: 2026-09-17
