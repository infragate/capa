# Qwen Code (`qwen-code`)

> **Status:** Full integration  
> **Skills dir:** `.qwen/skills/` (global: `~/.qwen/skills`)  
> **Docs root:** <https://github.com/QwenLM/qwen-code>

Source-of-truth definition: [`src/shared/providers/registry.ts → qwen-code`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.qwen/skills/<id>/` | — |
| MCP | `.qwen/settings.json` → `mcpServers.capa.url` | Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.qwen/agents/<id>.md` | Markdown + YAML frontmatter. |
| Plugin manifests | — | Not declared. |

## Sources

- Qwen Code repo: <https://github.com/QwenLM/qwen-code>

Last verified: 2026-05-23
