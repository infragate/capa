# Junie (`junie`, JetBrains)

> **Status:** Full integration  
> **Skills dir:** `.junie/skills/` (global: `~/.junie/skills`)  
> **Docs root:** <https://www.jetbrains.com/help/junie/>

Source-of-truth definition: [`src/shared/providers/registry.ts → junie`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.junie/skills/<id>/` | — |
| MCP | `.junie/mcp/mcp.json` → `mcpServers.capa.url` | Note the nested `mcp/` directory. Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.junie/agents/<id>.md` | Markdown + YAML frontmatter. |
| Plugin manifests | — | Not declared. |

## Sources

- Junie help: <https://www.jetbrains.com/help/junie/>

Last verified: 2026-05-23
