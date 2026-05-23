# Kiro CLI (`kiro-cli`, AWS)

> **Status:** Full integration  
> **Skills dir:** `.kiro/skills/` (global: `~/.kiro/skills`)  
> **Docs root:** <https://docs.kiro.dev/>

Source-of-truth definition: [`src/shared/providers/registry.ts → kiro-cli`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.kiro/skills/<id>/` | — |
| MCP | `.kiro/settings/mcp.json` → `mcpServers.capa.url` | Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | `.kiro/steering/<id>.md` | Kiro calls these "steering" files. Capa emits plain markdown (no frontmatter) until the inclusion-mode field name is verified — see caveat. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- Kiro's docs describe an "inclusion mode" frontmatter
  (`inclusion: always` / `inclusion: fileMatch` / `inclusion: manual`),
  but the exact field name hasn't been verified against Kiro's source
  yet, so capa writes plain markdown today. Path scoping has to be added
  by hand for now.

## Sources

- Kiro docs: <https://docs.kiro.dev/>

Last verified: 2026-05-23
