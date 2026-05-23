# Qoder (`qoder`)

> **Status:** Partial integration  
> **Skills dir:** `.qoder/skills/` (global: `~/.qoder/skills`)  
> **Docs root:** <https://docs.qoder.com/>

Source-of-truth definition: [`src/shared/providers/registry.ts → qoder`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.qoder/skills/<id>/` | — |
| MCP | — *(UI-managed)* | Qoder users configure MCP through Settings → MCP; no project-local file. Sub-agent frontmatter can still reference MCP server names via `mcpServers:`. |
| Instructions | `AGENTS.md` | Compat layer — rules in `.qoder/rules/` take precedence on conflicts. |
| Rules | `.qoder/rules/<id>.md` | Plain markdown. Per-rule behaviour (`Always Apply` / `Specific Files` / `Model Decision` / `Manual`) is selected via the Qoder IDE rule editor, not YAML frontmatter. |
| Sub-agents | `.qoder/agents/<id>.md` | Markdown + YAML frontmatter: `name`, `description`, optional `tools`, `skills`, `mcpServers`. |
| Plugin manifests | — | Not declared. |

## Caveats

- Capa cannot drive the per-rule behaviour choice from the capabilities
  file (it's an IDE setting). Surface this in install output if users
  start asking why their `alwaysApply: true` rule isn't always-applied
  by Qoder.

## Sources

- Qoder docs: <https://docs.qoder.com/>

Last verified: 2026-05-23
