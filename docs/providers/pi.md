# Pi (`pi`)

> **Status:** Partial integration  
> **Skills dir:** `.pi/skills/` (global: `~/.pi/agent/skills`)  
> **Docs root:** <https://github.com/earendil-works/pi>

Source-of-truth definition: [`src/shared/providers/registry.ts → pi`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.pi/skills/<id>/` | — |
| MCP | — *(community extension only)* | Pi core explicitly does **not** ship MCP. Community extensions (`my-pi`, `pi-mcp-adapter`, `oh-my-pi`) converge on `./mcp.json`. Capa treats Pi MCP as extension-required rather than core. |
| Instructions | `AGENTS.md` | Pi walks up from cwd looking for `AGENTS.md` (and falls back to `CLAUDE.md`). |
| Rules | — | Not wired up. |
| Sub-agents | — | Not part of core Pi. |
| Plugin manifests | — | Not declared. |

## Sources

- Pi repo: <https://github.com/earendil-works/pi>

Last verified: 2026-05-23
