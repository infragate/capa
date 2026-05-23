# Kilo Code (`kilo`)

> **Status:** Full integration  
> **Skills dir:** `.kilocode/skills/` (global: `~/.kilocode/skills`)  
> **Docs root:** <https://kilocode.ai/>

Source-of-truth definition: [`src/shared/providers/registry.ts → kilo`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.kilocode/skills/<id>/` | Uses legacy `.kilocode/` path (Kilo is renaming to `.kilo/`). |
| MCP | `.kilocode/mcp.json` → `mcpServers.capa.url` | Legacy path, still loaded by current Kilo. Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | `.kilo/rules/<id>.md` | Plain markdown, no frontmatter. |
| Sub-agents | `.kilo/agent/<id>.md` | Markdown + YAML frontmatter. |
| Plugin manifests | — | Not declared. |

## Caveats

- Kilo is mid-rename from `.kilocode/` → `.kilo/`. Capa uses the legacy
  MCP path (still loaded by current Kilo releases) but the new rules /
  sub-agents paths. Revisit when the rename completes.

## Sources

- Kilo Code: <https://kilocode.ai/>

Last verified: 2026-05-23
