# Mux (`mux`)

> **Status:** Held back — needs infrastructure changes  
> **Skills dir:** `.mux/skills/` (global: `~/.mux/skills`)  
> **Docs root:** Mux docs (TBD)

Source-of-truth definition: [`src/shared/providers/registry.ts → mux`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.mux/skills/<id>/` | — |
| MCP | — *(held back)* | `.mux/mcp.jsonc` uses top-level **`servers`** (not `mcpServers`) and stores **bare shell-command strings**, not URL-based entries. Doesn't fit capa's URL-based MCP model at all. |
| Instructions | — | Not documented. |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Blocking work

- Extend `McpIntegration` / `buildMcpEntry` to support stdio-style
  command entries (something like
  `{ command: 'capa-server', args: [...] }` instead of `{ url: ... }`).
  Capa's URL-based handshake assumes streamable HTTP — anything else is
  a substantially different code path.

## Sources

- Mux repo (verify URL)

Last verified: 2026-05-23
