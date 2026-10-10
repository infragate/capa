# Antigravity (`antigravity`)

> **Status:** Full integration  
> **Skills dir:** `.agents/skills/` (global: `~/.gemini/config/skills`)  
> **Docs root:** <https://antigravity.google/docs/>

Source-of-truth definition: [`src/shared/providers/entries/antigravity.ts`](../../src/shared/providers/entries/antigravity.ts).

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.agents/skills/<id>/` | Universal `.agents/skills/` layout. |
| MCP | `.agents/mcp_config.json` → `mcpServers.capa.serverUrl` | **Note `serverUrl`**: Antigravity rejects `url` and `httpUrl` for remote servers, and documents no `type` field. Native `--passthrough` MCP entries keep their `headers`, which Antigravity supports. Supports sub-agent entries. |
| Instructions | `AGENTS.md` | Antigravity also reads `GEMINI.md`. |
| Rules | `.agents/rules/<id>.md` | Plain markdown, no frontmatter. The legacy `.agent/rules/` is still read. |
| Hooks | `.agents/hooks.json` | Keyed by hook **name**, not by event (see [Hooks file shape](#hooks-file-shape)). Capa writes one `capa:<id>` key per hook and only touches keys it tagged. |
| Workflows / slash commands | Not wired up | |
| Sub-agents | Not wired up | |
| Plugin manifests | Not declared | |

Capa only writes the workspace files. The global equivalents
(`~/.gemini/config/mcp_config.json`, `~/.gemini/config/hooks.json`) are left
alone, like every other provider's global config.

## Hooks file shape

Unlike Claude Code, `.agents/hooks.json` maps hook names to event configs. Tool
events (`PreToolUse`, `PostToolUse`) hold `{ matcher, hooks: [...] }` groups;
`PreInvocation`, `PostInvocation` and `Stop` list handlers directly and ignore
matchers. Capa's output looks like:

```json
{
  "capa:lint": {
    "PostToolUse": [
      { "matcher": "run_command", "hooks": [{ "type": "command", "command": "./lint.sh", "timeout": 10 }] }
    ]
  },
  "capa:wrap-up": {
    "Stop": [{ "type": "command", "command": "./wrap-up.sh" }]
  }
}
```

- Handlers only support `type: "command"`, so `type: prompt` hooks are skipped
  with a warning. `failClosed` has no equivalent and is ignored.
- A user's `"enabled": false` on a `capa:<id>` key survives re-installs.
- `--passthrough` writes `capa-passthrough:<id>` keys instead, so it can't
  overwrite a hook you named `<id>` yourself, and `capa clean` leaves them alone.
- A `matcher` on a non-tool event is dropped, since Antigravity ignores it.

## Hooks event mapping

Canonical → Antigravity: `beforeTool → PreToolUse`, `afterTool → PostToolUse`,
`beforeShell → PreToolUse` + `matcher: run_command`,
`afterShell → PostToolUse` + `matcher: run_command`,
`beforeFileRead → PreToolUse` + `matcher: view_file`,
`afterFileEdit → PostToolUse` + `matcher: write_to_file|replace_file_content|multi_replace_file_content`,
`stop → Stop`.

Not mapped: `sessionStart`, `sessionEnd`, `userPromptSubmit`, `subagentStart`,
`subagentStop`, `preCompact` (no equivalent), and `beforeMcpCall` /
`afterMcpCall` (the docs don't say how MCP tools are named in matchers).
`PreInvocation` fires before every model call, not once per prompt, so it is
not mapped to `userPromptSubmit`; target it directly with
`on: antigravity:PreInvocation` (same for `PostInvocation`).

Agent activity hooks are installed for the mapped events. Traces are grouped by
`conversationId`; Antigravity has no per-turn id, and `PostToolUse` carries
only an `error` string, not the tool output.

## Caveats

- Capa registers as `serverUrl`. Don't regress it to `url`.
- Detection checks the legacy `.agent/` and `~/.gemini/antigravity`. It
  skips `.agents/` on purpose: capa writes that tree for every
  universal-layout provider, so it would report Antigravity in most projects.

## Sources

- Skills: <https://antigravity.google/docs/skills/>
- Rules & workflows: <https://antigravity.google/docs/rules-workflows/>
- MCP (`.agents/mcp_config.json`, `serverUrl`, `headers`): <https://antigravity.google/docs/mcp/>
- Hooks (`.agents/hooks.json`, events, matchers, stdin fields): <https://antigravity.google/docs/hooks/>

Last verified: 2026-10-10
