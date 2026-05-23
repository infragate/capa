# Kode (`kode`)

> **Status:** Full integration  
> **Skills dir:** `.kode/skills/` (global: `~/.kode/skills`)  
> **Docs root:** Kode GitHub repo (link pending verification)

Source-of-truth definition: [`src/shared/providers/registry.ts → kode`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.kode/skills/<id>/` | — |
| MCP | `.mcp.json` → `mcpServers.capa.url` | Project-root MCP file (claude-style). Supports sub-agent entries. |
| Instructions | `AGENTS.md` | Kode also reads optional `AGENTS.override.md`. |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.kode/agents/<id>.md` | Markdown + YAML frontmatter. |
| Plugin manifests | — *(held back)* | New manifests live at `.kode-plugin/plugin.json`, which has a Kode-specific schema with no capa parser. Plugins still shipping the legacy `.claude-plugin/plugin.json` are already covered by the [claude-code](./claude-code.md) entry, so a Kode-side declaration is not required for those. See [Plugin format support](../README.md#plugin-format-support). |

## Sources

- Kode repo (verify): <https://github.com/>

Last verified: 2026-05-23
