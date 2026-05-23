# Cline (`cline`)

> **Status:** Partial integration  
> **Skills dir:** `.cline/skills/` (global: `~/.cline/skills`)  
> **Docs root:** <https://docs.cline.bot/>

Source-of-truth definition: [`src/shared/providers/registry.ts → cline`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.cline/skills/<id>/` | — |
| MCP | — *(global only)* | Cline stores MCP servers at `~/.cline/mcp.json` (or in VS Code globalStorage); no project-local file. |
| Instructions | `AGENTS.md` | — |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Sources

- Cline docs: <https://docs.cline.bot/>

Last verified: 2026-05-23
