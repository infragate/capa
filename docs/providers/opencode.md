# OpenCode (`opencode`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `~/.config/opencode/skills`)  
> **Docs root:** <https://opencode.ai/docs/>

Source-of-truth definition: [`src/shared/providers/registry.ts → opencode`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | OpenCode also reads `.opencode/skills/` and `.claude/skills/`; capa uses the universal `.agents/skills/` layout. |
| MCP | `opencode.json` → `mcp.capa` | Project-root config per [OpenCode config docs](https://opencode.ai/docs/config/). Capa writes `{ type: "remote", url, enabled: true }`. Supports sub-agent entries. |
| Instructions | `AGENTS.md` | OpenCode also supports an `instructions` array in `opencode.json`; capa uses the shared `AGENTS.md` marker blocks. |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | `.opencode/agents/<id>.md` | Markdown + frontmatter; capa sets `mode: subagent`. |
| Plugin manifests | — | Not declared. |

## Sources

- OpenCode docs: <https://opencode.ai/docs/>
- OpenCode config: <https://opencode.ai/docs/config/>
- OpenCode skills: <https://opencode.ai/docs/skills/>
- OpenCode agents: <https://opencode.ai/docs/agents/>

Last verified: 2026-06-08
