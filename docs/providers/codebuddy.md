# CodeBuddy (`codebuddy`)

> **Status:** Partial integration  
> **Skills dir:** `.codebuddy/skills/` (global: `~/.codebuddy/skills`)  
> **Docs root:** <https://copilot.tencent.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → codebuddy`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.codebuddy/skills/<id>/` | — |
| MCP | `.mcp.json` → `mcpServers.capa.url` | **CLI only** — the CodeBuddy IDE extension does not read this file. Supports sub-agent entries. |
| Instructions | `CODEBUDDY.md` | Falls back to `AGENTS.md` when CodeBuddy is co-installed with other providers. |
| Rules | — | CodeBuddy uses `.codebuddy/rules/<name>/RULE.mdc` (directory-per-rule), which doesn't fit capa's flat file model — not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Caveats

- The `.mcp.json` path is the **CodeBuddy CLI** convention, not the IDE
  extension's. Surfacing the CLI-vs-IDE distinction in capa's UX would
  prevent surprises.
- Rules use a directory-per-rule layout (`<name>/RULE.mdc`), which capa
  doesn't write today. Revisit if rule support becomes important.

## Sources

- CodeBuddy docs: <https://copilot.tencent.com/>

Last verified: 2026-05-23
