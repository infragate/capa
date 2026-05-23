# Goose (`goose`)

> **Status:** Partial integration  
> **Skills dir:** `.goose/skills/` (global: `~/.config/goose/skills`)  
> **Docs root:** <https://block.github.io/goose/>

Source-of-truth definition: [`src/shared/providers/registry.ts → goose`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.goose/skills/<id>/` | — |
| MCP | — *(global only)* | Goose configures MCP via `~/.config/goose/config.yaml`; no project-local file. |
| Instructions | `AGENTS.md` | — |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Sources

- Goose docs: <https://block.github.io/goose/>

Last verified: 2026-05-23
