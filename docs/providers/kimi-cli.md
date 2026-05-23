# Kimi Code CLI (`kimi-cli`)

> **Status:** Partial integration  
> **Skills dir:** `.agents/skills/` (global: `~/.config/agents/skills`)  
> **Docs root:** Kimi Code docs (TBD)

Source-of-truth definition: [`src/shared/providers/registry.ts → kimi-cli`](../../src/shared/providers/registry.ts).

Workspace presence is detected via `~/.kimi`, even though the skills tree
uses the universal `.agents/skills/` location.

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | — *(global only)* | Kimi reads `~/.kimi/mcp.json`; no project-local file. |
| Instructions | `AGENTS.md` | — |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Sources

- Kimi Code CLI (verify URL)

Last verified: 2026-05-23
