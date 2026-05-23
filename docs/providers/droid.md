# Droid (`droid`, Factory)

> **Status:** Full integration  
> **Skills dir:** `.factory/skills/` (global: `~/.factory/skills`)  
> **Docs root:** <https://docs.factory.ai/>

Source-of-truth definition: [`src/shared/providers/registry.ts → droid`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.factory/skills/<id>/` | — |
| MCP | `.factory/mcp.json` → `mcpServers.capa.url` | Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.factory/droids/<id>.md` | Markdown + rich YAML frontmatter (`name`, `description`, `model: inherit`, `reasoningEffort`, `tools`). |
| Plugin manifests | — *(held back)* | `.factory-plugin/plugin.json` exists in Factory's docs but the schema is not Claude- or Cursor-compatible, so capa does not declare it yet — see [Plugin format support](../README.md#plugin-format-support). |

## Sources

- Factory docs: <https://docs.factory.ai/>

Last verified: 2026-05-23
