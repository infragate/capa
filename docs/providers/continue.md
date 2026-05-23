# Continue (`continue`)

> **Status:** Held back — needs infrastructure changes  
> **Skills dir:** `.continue/skills/` (global: `~/.continue/skills`)  
> **Docs root:** <https://docs.continue.dev/>

Source-of-truth definition: [`src/shared/providers/registry.ts → continue`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.continue/skills/<id>/` | — |
| MCP | — *(held back)* | `.continue/mcpServers/*.yaml`. YAML, one file per server, each requiring `name` / `version` / `schema` metadata. Capa has no YAML writer today. |
| Instructions | — | Continue is the only major provider that does **not** read `AGENTS.md`; it uses `.continue/rules/` instead. |
| Rules | — *(needs YAML)* | `.continue/rules/*.yaml`/`*.md` rules use Continue's own frontmatter dialect — not yet wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Blocking work

- Add a YAML writer to capa's MCP handler with support for one-file-per-
  server layouts.
- Decide how to surface "no AGENTS.md" to users — they may expect their
  global agent-instructions to land somewhere.

## Sources

- Continue docs: <https://docs.continue.dev/>

Last verified: 2026-05-23
