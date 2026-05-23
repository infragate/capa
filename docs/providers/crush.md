# Crush (`crush`)

> **Status:** Full integration  
> **Skills dir:** `.crush/skills/` (global: `~/.config/crush/skills`)  
> **Docs root:** <https://github.com/charmbracelet/crush>

Source-of-truth definition: [`src/shared/providers/registry.ts → crush`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.crush/skills/<id>/` | — |
| MCP | `.crush.json` → `mcp.capa.url` | Top-level key is **`mcp`**, not `mcpServers`. Same shape as OpenCode. Supports sub-agent entries. |
| Instructions | `AGENTS.md` | — |
| Rules | folded into `AGENTS.md` | No project-local rules directory; rules become marker blocks. |
| Sub-agents | — | No sub-agent directory wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- The `mcp` top-level key vs `mcpServers` is a common silent-failure trap.
  Double-check anytime the MCP config layout changes.

## Sources

- Crush repo: <https://github.com/charmbracelet/crush>

Last verified: 2026-05-23
