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
| Instructions | `CLAUDE.md` | Universal marker blocks. `AGENTS.md` is **only** written if another active provider declares it (e.g. `codex`, `cursor`); a claude-code-only install never produces an `AGENTS.md`. |
| Rules | `.claude/rules/<id>.md` | YAML frontmatter — capa's `appliesTo` maps to `paths`. A file with no `paths` is loaded unconditionally. |
| Sub-agents | `.claude/agents/<id>.md` | Markdown + frontmatter (`name`, `description`, `model: inherit`). Also folds a `sub-agent:<id>` snippet into `CLAUDE.md`. |
| Hooks | `.claude/settings.json` → `hooks` | JSON map keyed by event (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`, `PreCompact`, `Notification`). Capa upserts `[{ matcher, hooks: [{ name: "capa:<id>", type, command, timeout }] }]` and only touches the entries it tagged. |
| Plugin manifests | `.claude-plugin/plugin.json` (`pluginProviderId: claude`) | Parsed by `parseClaudeManifest`. Hoisted to front of plugin search order — see [plugin docs](../README.md#plugin-discovery-and-unpack). |

## Hooks event mapping

Capa translates canonical events to Claude's hook event names:
`beforeTool → PreToolUse`, `afterTool → PostToolUse`,
`userPromptSubmit → UserPromptSubmit`, `sessionStart → SessionStart`,
`sessionEnd → SessionEnd`, `stop → Stop`, `subagentStop → SubagentStop`,
`preCompact → PreCompact`. `beforeShell` / `afterShell` re-use
`PreToolUse` / `PostToolUse` with an automatic `matcher: Bash` so the
hook only fires for shell tool invocations.

## Sources

- Memory & rules organisation: <https://code.claude.com/docs/en/memory>
- `.claude/rules/`: <https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/>
- Hooks reference: <https://docs.claude.com/en/docs/claude-code/hooks>
- Hooks settings (`.claude/settings.json` → `hooks`): <https://docs.claude.com/en/docs/claude-code/settings>

Last verified: 2026-05-24
