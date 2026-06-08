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
| Sub-agents | `.opencode/agents/<id>.md` | Markdown + frontmatter; capa sets `mode: subagent` and emits a `permission` allow rule for the agent's own MCP (see scope fence below). |
| Plugin manifests | — | Not declared. |

## Sub-agent MCP scope fence

OpenCode auto-exposes every entry under the top-level `mcp` key to all primary agents (Build, Plan, …) by default — see [MCP servers › Per agent](https://opencode.ai/docs/mcp-servers/#per-agent). Without scoping, every `capa-<id>` MCP that capa registers for a sub-agent would pollute the main session with sub-agent-only tool blocks.

To prevent that, capa writes a top-level `permission` deny pattern in `opencode.json` and a matching allow pattern in each sub-agent's frontmatter:

```jsonc
// opencode.json
{
  "mcp": {
    "capa":          { "type": "remote", "url": "…", "enabled": true },
    "capa-reviewer": { "type": "remote", "url": "…", "enabled": true }
  },
  "permission": {
    "capa-*_*": "deny"   // sub-agent MCPs hidden from primary sessions
  }
}
```

```markdown
---
name: reviewer
mode: subagent
permission:
  "capa-reviewer_*": allow
---
```

The pattern `capa-*_*` matches sub-agent MCP tool names (`capa-<id>_<tool>`) but intentionally **does not** match the main `capa_*` tools, so the primary session keeps full access to capa's main MCP. Any user-authored permission entries in `opencode.json` are preserved.

## Sources

- OpenCode docs: <https://opencode.ai/docs/>
- OpenCode config: <https://opencode.ai/docs/config/>
- OpenCode skills: <https://opencode.ai/docs/skills/>
- OpenCode agents: <https://opencode.ai/docs/agents/>
- OpenCode MCP servers: <https://opencode.ai/docs/mcp-servers/>

Last verified: 2026-06-08
