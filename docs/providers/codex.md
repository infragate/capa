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
| Hooks | `.codex/config.toml` → `[hooks]` | TOML tables. Codex does not support a `name` tag, so capa keys each entry by `id = "<hookId>"` and tracks `(event, hookId)` in `managed_hooks` for surgical updates. |
| Plugin manifests | — | Not declared; Codex consumes plugins via the same Claude/Cursor manifest paths handled elsewhere. |

## Hooks event mapping

Codex's hook surface is narrower than Claude's: capa only writes
canonical events that map onto Codex's documented `[hooks]` keys
(`beforeTool`, `afterTool`, `sessionStart`, `sessionEnd`,
`userPromptSubmit`). Hooks targeting events Codex does not support are
skipped with a one-shot warning.

## Sources

- Codex repo & config docs: <https://github.com/openai/codex>
- Codex hooks (`config.toml` → `[hooks]`): <https://github.com/openai/codex/blob/main/docs/config.md#hooks>

Last verified: 2026-05-24
