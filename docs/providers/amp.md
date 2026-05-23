# Amp (`amp`)

> **Status:** Held back — needs infrastructure changes  
> **Skills dir:** `.agents/skills/` (global: `~/.config/agents/skills`)  
> **Docs root:** <https://ampcode.com/manual>

Source-of-truth definition: [`src/shared/providers/registry.ts → amp`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. Sub-agents share this path via `SKILL.md`. |
| MCP | — *(held back)* | `.amp/settings.json` uses a nested **`amp.mcpServers`** key. Capa's current `serversKey: string` is flat; we'd need dotted-path support before we can write here. |
| Instructions | — | No project-root instructions file documented. |
| Rules | — | Not wired up. |
| Sub-agents | — | Folded into the skills tree (`.agents/skills/<n>/SKILL.md`). |
| Plugin manifests | — | Not declared. |

## Blocking work

- Extend `McpIntegration` to express dotted keys
  (`serversKey: 'amp.mcpServers'` should walk the JSON tree, creating
  intermediate objects when missing).

## Sources

- Amp manual: <https://ampcode.com/manual>

Last verified: 2026-05-23
