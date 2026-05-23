# Replit (`replit`)

> **Status:** Partial integration  
> **Skills dir:** `.agents/skills/` (global: `~/.config/agents/skills`)  
> **Docs root:** <https://docs.replit.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → replit`](../../src/shared/providers/registry.ts).

Replit is hidden from the universal provider list
(`showInUniversalList: false`); users opt into it explicitly.

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | — *(UI-only)* | MCP is added via Replit's Integrations page (per-account, not per-project). |
| Instructions | `replit.md` | Must live at the project root; Replit does **not** detect subdirectory files. Note: **not** `AGENTS.md`. |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- The instructions filename is `replit.md` (lowercase). Capa does **not**
  fall back to `AGENTS.md` for Replit because the Replit Agent reads
  `replit.md` only.

## Sources

- Replit docs: <https://docs.replit.com/>

Last verified: 2026-05-23
