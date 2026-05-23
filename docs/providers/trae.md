# Trae (`trae`)

> **Status:** Full integration  
> **Skills dir:** `.trae/skills/` (global: `~/.trae/skills`)  
> **Docs root:** <https://docs.trae.ai/>

Source-of-truth definition: [`src/shared/providers/registry.ts → trae`](../../src/shared/providers/registry.ts).

See also [`trae-cn`](./trae-cn.md) for the Chinese-market build.

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.trae/skills/<id>/` | — |
| MCP | `.trae/mcp.json` → `mcpServers.capa.url` | Supports sub-agent entries. **Requires user opt-in** in Trae Settings → Agents before the file is read. |
| Instructions | `AGENTS.md` | — |
| Rules | `.trae/rules/<id>.md` | Plain markdown, no frontmatter. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- `.trae/mcp.json` is only consulted when the user toggles
  Settings → Agents → "Read project MCP config". Worth surfacing in
  `capa install` output so users aren't surprised.

## Sources

- Trae docs: <https://docs.trae.ai/>

Last verified: 2026-05-23
