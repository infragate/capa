# iFlow CLI (`iflow-cli`)

> **Status:** Partial integration  
> **Skills dir:** `.iflow/skills/` (global: `~/.iflow/skills`)  
> **Docs root:** iFlow platform docs (TBD)

Source-of-truth definition: [`src/shared/providers/registry.ts → iflow-cli`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.iflow/skills/<id>/` | — |
| MCP | `.iflow/settings.json` → `mcpServers.capa.url` | Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | — | Not wired up. |
| Sub-agents | — *(held back)* | Official platform docs say `.iflow/agents/` but a DeepWiki dump disagrees on the file shape. Not wired up until verified against a real install. |
| Plugin manifests | — | Not declared. |

## Caveats

- Sub-agent integration deliberately omitted because the two known
  documentation sources contradict each other on directory layout. Add
  it only after a hands-on verification.

## Sources

- iFlow platform docs (verify URL)

Last verified: 2026-05-23
