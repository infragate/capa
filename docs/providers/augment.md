# Augment (`augment`)

> **Status:** Partial integration  
> **Skills dir:** `.augment/skills/` (global: `~/.augment/skills`)  
> **Docs root:** <https://docs.augmentcode.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → augment`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.augment/skills/<id>/` | — |
| MCP | — *(global only)* | Augment manages MCP at `~/.augment/settings.json`; no project-local file. |
| Instructions | `AGENTS.md` | — |
| Rules | — | Not wired up. |
| Sub-agents | `.augment/agents/<id>.md` | Markdown + frontmatter. |
| Plugin manifests | — *(held back)* | `.augment-plugin/plugin.json` exists in Augment's docs but the schema is not Claude- or Cursor-compatible. Held back until a `parsePluginManifest` callback is added — see [Plugin format support](../README.md#plugin-format-support). |

## Sources

- Augment docs: <https://docs.augmentcode.com/>

Last verified: 2026-05-23
