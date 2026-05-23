# Zencoder (`zencoder`)

> **Status:** Held back — needs vendor doc confirmation  
> **Skills dir:** `.zencoder/skills/` (global: `~/.zencoder/skills`)  
> **Docs root:** <https://docs.zencoder.ai/>

Source-of-truth definition: [`src/shared/providers/registry.ts → zencoder`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.zencoder/skills/<id>/` | — |
| MCP | — *(UI-managed)* | Zencoder configures MCP through the IDE; no project file. |
| Instructions | — | Not documented. |
| Rules | — *(unverified)* | `.zencoder/rules/<id>.md(c)` likely accepts `alwaysApply` / `globs` frontmatter, but the live docs page redirected to a Skills page at research time. Held until the vendor docs settle. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Blocking work

- Confirm the exact frontmatter dialect for `.zencoder/rules/`, then
  decide whether the extension is `.md` or `.mdc` (and whether both are
  accepted).

## Sources

- Zencoder docs: <https://docs.zencoder.ai/>

Last verified: 2026-05-23
