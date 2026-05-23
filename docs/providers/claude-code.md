# Claude Code (`claude-code`)

> **Status:** Full integration  
> **Skills dir:** `.claude/skills/` (global: `$CLAUDE_CONFIG_DIR/skills`)  
> **Docs root:** <https://code.claude.com/docs/en/memory>

Source-of-truth definition: [`src/shared/providers/registry.ts → claude-code`](../../src/shared/providers/registry.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.claude/skills/<id>/` | Standard SKILL.md tree. |
| MCP | `.mcp.json` → `mcpServers.capa.url` | JSON map; per-sub-agent entries (`mcpServers.capa-<agentId>`) supported. |
| Instructions | `CLAUDE.md` | Universal marker blocks; `AGENTS.md` also written if any other provider is active. |
| Rules | `.claude/rules/<id>.md` | YAML frontmatter — capa's `appliesTo` maps to `paths`. A file with no `paths` is loaded unconditionally. |
| Sub-agents | `.claude/agents/<id>.md` | Markdown + frontmatter (`name`, `description`, `model: inherit`). Also folds a `sub-agent:<id>` snippet into `CLAUDE.md`. |
| Plugin manifests | `.claude-plugin/plugin.json` (`pluginProviderId: claude`) | Parsed by `parseClaudeManifest`. Hoisted to front of plugin search order — see [plugin docs](../README.md#plugin-discovery-and-unpack). |

## Sources

- Memory & rules organisation: <https://code.claude.com/docs/en/memory>
- `.claude/rules/`: <https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/>

Last verified: 2026-05-23
