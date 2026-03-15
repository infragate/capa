# Capabilities File Schema

Full reference for `capabilities.yaml` / `capabilities.json` structure: basic layout, skills (all six types), servers, tools, security, `requiresCommands`, and the `agents` section.

## Basic Structure (YAML)

```yaml
providers:
  - cursor
  - claude-code

options:
  toolExposure: expose-all  # or 'on-demand'
  # security: { blockedPhrases, allowedCharacters }
  # requiresCommands: [ { cli, description? } ]

# agents: { base?, additional? }

skills:
  - id: skill-id
    type: inline|remote|github|gitlab|local|installed
    def: { ... }

servers:
  - id: server-id
    type: mcp
    def: { ... }

tools:
  - id: tool-id
    type: mcp|command
    def: { ... }
```

## Skills Section (six types)

- **inline**: Embed SKILL.md content in `def.content`. Use `requires: ['@server_id.tool_id']` for MCP tools, plain ID for command tools.
- **github**: `def.repo: owner/repo@skill-name` (optional `:version` or `#sha`).
- **gitlab**: `def.repo: group/subgroup/repo@skill-name`.
- **remote**: `def.url` to a SKILL.md URL.
- **local**: `def.path` to a directory containing SKILL.md (read on each install).
- **installed**: User installed the skill elsewhere; capa only records it for tool binding. CLI: `capa add <id> --installed [--requires "..."]`.

## Servers Section

- **Local (subprocess)**: `def.cmd`, `def.args`, optional `def.env` with `${VarName}`.
- **Remote (HTTP)**: `def.url`, optional `def.headers`. Use `tlsSkipVerify: true` for self-signed certs. OAuth2 probe is skipped when `Authorization` header is set.

Optional top-level `description` is shown in `capa sh`.

## Security Options (`options.security`)

- **blockedPhrases**: List of strings, or `{ file: "./path.txt" }`. Blocks install if any skill file contains a phrase. Omit to disable.
- **allowedCharacters**: Extra regex character class beyond baseline (printable ASCII + tab/LF/CR). `""` = baseline only; `"[\\u00A0-\\uFFFF]"` = allow all Unicode. Omit to disable sanitization.

Only present properties are applied. Same checks apply to agent snippet content.

## CLI Prerequisites (`options.requiresCommands`)

List of `{ cli: "executable", description?: "hint" }`. Install fails if any command is missing (`which`/`where`).

## Tools Section

- **MCP tool**: `def.server: "@server-id"`, `def.tool: tool_name`. Optional `def.defaults` for pre-filled args. Reference in skills as `@server_id.tool_id`.
- **Command tool**: `def.run.cmd` with `{arg}` placeholders, `def.run.args` (name, type, description, required, optional `default`). Optional `def.init.cmd` for one-time setup. Optional `group` for nesting in `capa sh`.

Optional top-level `description` for MCP schema and `capa sh`.

## Agents Section

Manages `AGENTS.md` and (when `claude-code` in providers) `CLAUDE.md`.

- **base**: Optional. `ref: url` or `type: github|gitlab|local` with `def.repo` or `path`. Content written without markers; re-downloaded on each install.
- **additional**: List of snippets. Each wrapped in `<!-- capa:start:id -->` … `<!-- capa:end:id -->`. Types: `inline` (id, content), `remote` (id, url), `github`/`gitlab` (def.repo; id optional). `def.repo` format: `owner/repo@filepath` with optional `:version` or `#sha`.

`capa install` upserts and prunes by id. `capa clean` removes all capa-owned blocks; empty files are deleted.

For full YAML examples of every skill type, server type, security block, requiresCommands, tool defaults/group, and agents schema, see the original capability file docs or the examples in `references/workflows-and-examples.md`.
