# Neovate (`neovate`)

> **Status:** Partial integration  
> **Skills dir:** `.neovate/skills/` (global: `~/.neovate/skills`)  
> **Docs root:** Neovate repo (TBD)

Source-of-truth definition: [`src/shared/providers/registry.ts → neovate`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.neovate/skills/<id>/` | — |
| MCP | `.neovate/config.json` → `mcpServers.capa.url` | Supports sub-agent entries. |
| Instructions | — | No project-root instructions file documented. |
| Rules | — | Not wired up. |
| Sub-agents | — | Neovate sub-agents are registered through TypeScript plugin code, not files, so capa cannot write them. |
| Plugin manifests | — | Not declared. |

## Caveats

- Sub-agents come from plugin code rather than disk, which means the
  generic capa "write file → done" model doesn't apply. If support is
  ever needed, we'd need a Neovate-specific writer.

## Sources

- Neovate repo (verify URL)

Last verified: 2026-05-23
