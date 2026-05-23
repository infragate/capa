# Cursor (`cursor`)

> **Status:** Full integration  
> **Skills dir:** `.cursor/skills/` (global: `~/.cursor/skills`)  
> **Docs root:** <https://docs.cursor.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → cursor`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.cursor/skills/<id>/` | — |
| MCP | `.cursor/mcp.json` → `mcpServers.capa.url` | **Does not** support sub-agent entries (`supportsSubAgentEntries: false`); capa sets `purgeStaleSubAgentMcp: true` to strip leftover `capa-*` keys. |
| Instructions | `AGENTS.md` | — |
| Rules | `.cursor/rules/<id>.mdc` | YAML frontmatter: `description`, `globs` (from capa's `appliesTo`), `alwaysApply`. |
| Sub-agents | `.cursor/agents/<id>.md` | Markdown + frontmatter (`model`, `readonly`, `is_background`). |
| Plugin manifests | `.cursor-plugin/plugin.json` (`pluginProviderId: cursor`) | Parsed by `parseCursorManifest` — see [plugin docs](../README.md#plugin-discovery-and-unpack). |

## Sources

- Cursor docs: <https://docs.cursor.com/>

Last verified: 2026-05-23
