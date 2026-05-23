# Windsurf (`windsurf`)

> **Status:** Full integration  
> **Skills dir:** `.windsurf/skills/` (global: `~/.codeium/windsurf/skills`)  
> **Docs root:** <https://docs.windsurf.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → windsurf`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.windsurf/skills/<id>/` | — |
| MCP | — | No project-local MCP integration. |
| Instructions | — | No project-root instructions file. |
| Rules | `.windsurf/rules/<id>.md` | YAML frontmatter with non-trivial field mapping — see below. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

### Rules frontmatter mapping

Windsurf accepts a `trigger` field instead of a boolean `alwaysApply`:

| capa field | Windsurf field | Value |
| --- | --- | --- |
| `description` | `description` | as-is |
| `appliesTo` | `globs` | as-is |
| `alwaysApply: true` | `trigger` | `always_on` |
| `alwaysApply: false` *(or unset)* | `trigger` | `model_decision` |

The mapping is encoded as `alwaysApplyValues` on the `rules` integration
in the registry.

## Sources

- Windsurf docs: <https://docs.windsurf.com/>

Last verified: 2026-05-23
