# Gemini CLI (`gemini-cli`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `~/.gemini/skills`)  
> **Docs root:** <https://github.com/google-gemini/gemini-cli>

Source-of-truth definition: [`src/shared/providers/registry.ts → gemini-cli`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.gemini/settings.json` → `mcpServers.capa.httpUrl` | **Note `httpUrl`** (streamable HTTP), not `url` (SSE). Supports sub-agent entries. |
| Instructions | `AGENTS.md` | Supported via configurable `context.fileName`. |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.gemini/agents/<id>.md` | Markdown + YAML frontmatter; `name` / `description` required. |
| Plugin manifests | — | Not declared. |

## Caveats

- Capa registers as `httpUrl` (streamable HTTP), not `url` (SSE). Don't
  accidentally regress that — the two transports are not interchangeable.

## Sources

- Gemini CLI repo: <https://github.com/google-gemini/gemini-cli>

Last verified: 2026-05-23
