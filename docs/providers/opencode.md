# OpenCode (`opencode`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `~/.config/opencode/skills`)  
> **Docs root:** <https://opencode.ai/docs/>

Source-of-truth definition: [`src/shared/providers/registry.ts → opencode`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.opencode/opencode.json` → `mcp.capa.url` | Top-level key is **`mcp`**, not `mcpServers`. Same shape as Crush. Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.opencode/agents/<id>.md` | Markdown + frontmatter. |
| Plugin manifests | — | Not declared. |

## Sources

- OpenCode docs: <https://opencode.ai/docs/>

Last verified: 2026-05-23
