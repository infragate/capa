# Trae CN (`trae-cn`)

> **Status:** Full integration  
> **Skills dir:** `.trae/skills/` (global: `~/.trae-cn/skills`)  
> **Docs root:** <https://docs.trae.com.cn/>

Source-of-truth definition: [`src/shared/providers/registry.ts → trae-cn`](../../src/shared/providers/registry.ts).

Sibling of [`trae`](./trae.md) — same project-local file layout, different
distribution channel for the Chinese market.

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.trae/skills/<id>/` | Shares the workspace path with `trae`; the global directory differs (`~/.trae-cn/skills`). |
| MCP | `.trae/mcp.json` → `mcpServers.capa.url` | Supports sub-agent entries. **Requires user opt-in** in Trae Settings → Agents. |
| Instructions | `AGENTS.md` | — |
| Rules | `.trae/rules/<id>.md` | Plain markdown, no frontmatter. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- Same project-local opt-in as Trae — surface it in `capa install`
  output.
- The home detection looks for `~/.trae-cn` (instead of `~/.trae`) to
  distinguish the build.

## Sources

- Trae CN docs: <https://docs.trae.com.cn/>

Last verified: 2026-05-23
