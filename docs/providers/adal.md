# AdaL (`adal`)

> **Status:** Partial integration  
> **Skills dir:** `.adal/skills/` (global: `~/.adal/skills`)  
> **Docs root:** <https://docs.sylph.ai/>

Source-of-truth definition: [`src/shared/providers/registry.ts → adal`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.adal/skills/<id>/` | — |
| MCP | — *(CLI-managed)* | AdaL adds MCP servers at runtime via `/mcp add`; there is no project-local file to write. |
| Instructions | `AGENTS.md` | Follows SylphAI's own `AGENTS.md` exemplar. |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Sources

- AdaL docs: <https://docs.sylph.ai/>
- AdaL `AGENTS.md` exemplar: <https://github.com/SylphAI-Inc/adal-cli/blob/main/AGENTS.md>

Last verified: 2026-05-23
