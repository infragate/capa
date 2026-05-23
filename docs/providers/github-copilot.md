# GitHub Copilot (`github-copilot`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `~/.copilot/skills`)  
> **Docs root:** <https://docs.github.com/en/copilot>

Source-of-truth definition: [`src/shared/providers/registry.ts → github-copilot`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.vscode/mcp.json` → `servers.capa.url` | Top-level key is **`servers`**, not `mcpServers`. Does **not** support sub-agent entries. |
| Instructions | `.github/copilot-instructions.md` | Standard Copilot instructions location. |
| Rules | `.github/instructions/<id>.instructions.md` | YAML frontmatter — capa's `appliesTo` maps to `applyTo`. |
| Sub-agents | `.github/agents/<id>.md` | Markdown + frontmatter. Also folds a sub-agent snippet into `.github/copilot-instructions.md`. |
| Plugin manifests | — | Not declared. |

## Sources

- GitHub Copilot docs: <https://docs.github.com/en/copilot>

Last verified: 2026-05-23
