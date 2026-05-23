# Pochi (`pochi`)

> **Status:** Full integration  
> **Skills dir:** `.pochi/skills/` (global: `~/.pochi/skills`)  
> **Docs root:** <https://docs.getpochi.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → pochi`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.pochi/skills/<id>/` | — |
| MCP | `.pochi/config.jsonc` → `mcp.capa.url` | **JSONC**. Top-level key is `mcp`, not `mcpServers`. Capa writes vanilla JSON (no comments), which JSONC parses fine. Supports sub-agent entries. |
| Instructions | `README.pochi.md` | Preferred Pochi-specific filename; `AGENTS.md` is also written when other providers are active. |
| Rules | folded into `README.pochi.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.pochi/agents/<id>.md` | Markdown + YAML frontmatter; `description` required, `name` / `tools` optional. |
| Plugin manifests | — | Not declared. |

## Caveats

- `.pochi/config.jsonc` is JSONC. Capa writes plain JSON, which is a
  strict subset, so the file remains parseable — but any human-written
  comments will round-trip safely because capa preserves unrelated keys.

## Sources

- Pochi docs root: <https://docs.getpochi.com/>
- MCP: <https://docs.getpochi.com/mcp/>
- Custom agents: <https://docs.getpochi.com/custom-agent/>

Last verified: 2026-05-23
