# OpenHands (`openhands`)

> **Status:** Partial integration  
> **Skills dir:** `.openhands/skills/` (global: `~/.openhands/skills`)  
> **Docs root:** <https://docs.all-hands.dev/>

Source-of-truth definition: [`src/shared/providers/registry.ts → openhands`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.openhands/skills/<id>/` | — |
| MCP | — *(global only)* | OpenHands reads `~/.openhands/mcp.json` (or the runtime `config.toml`); no project-local file. |
| Instructions | `AGENTS.md` | — |
| Rules | — | Not wired up. |
| Sub-agents | — | OpenHands folds sub-agents into the skills / microagents directories rather than a separate `.openhands/agents/` location, so capa cannot model them as standalone files. |
| Plugin manifests | — | Not declared. |

## Sources

- OpenHands docs: <https://docs.all-hands.dev/>

Last verified: 2026-05-23
