# Mistral Vibe (`mistral-vibe`)

> **Status:** Partial integration  
> **Skills dir:** `.vibe/skills/` (global: `~/.vibe/skills`)  
> **Docs root:** <https://docs.mistral.ai/mistral-vibe/overview>

Source-of-truth definition: [`src/shared/providers/registry.ts → mistral-vibe`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.vibe/skills/<id>/` | — |
| MCP | — *(held back)* | `.vibe/config.toml` uses **TOML array-of-tables** (`[[mcp_servers]]`) instead of a map. Doesn't fit capa's `serversKey: <map>` model — see [held-back providers in main README](../README.md). |
| Instructions | `AGENTS.md` | Must live at the workspace root. |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- MCP integration is blocked on a second TOML writer mode for capa's MCP
  handler (array-of-tables instead of `[mcp_servers.<name>]` tables).

## Sources

- Mistral Vibe overview: <https://docs.mistral.ai/mistral-vibe/overview>

Last verified: 2026-05-23
