# Codex (`codex`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `$CODEX_HOME/skills`)  
> **Docs root:** <https://github.com/openai/codex>

Source-of-truth definition: [`src/shared/providers/registry.ts → codex`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.codex/config.toml` → `mcp_servers.capa.url` | **TOML** map. Supports per-sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; capa writes marker blocks into the instructions file. |
| Sub-agents | `.codex/agents/<id>.toml` | TOML format; body goes into the `developer_instructions` field. |
| Plugin manifests | — | Not declared; Codex consumes plugins via the same Claude/Cursor manifest paths handled elsewhere. |

## Sources

- Codex repo & config docs: <https://github.com/openai/codex>

Last verified: 2026-05-23
