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

# subagents: [ { id, description?, skills, tools, instructions?, agents? } ]
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

## Sub-Agents Section (`subagents`)

Defines named sub-agent configurations. On `capa install`, each sub-agent produces:

| Provider | MCP registration | Agent definition file | Notes |
|---|---|---|---|
| `claude-code` | `.mcp.json` → `capa-{id}` (filtered endpoint) | `.claude/agents/{id}.md` + `CLAUDE.md` block | Claude Code reads `.claude/agents/` for sub-agent definitions |
| `cursor` | (none — main `capa` entry only) | `.cursor/agents/{id}.md` | Cursor reads `description` field to auto-delegate |

The **filtered MCP endpoint** at `/{projectId}/agents/{id}/mcp` exposes only the tools declared in `tools`. Calls to other tools are rejected with a clear error.

```yaml
subagents:
  - id: infra-agent
    description: AWS CDK and Terraform specialist. Use when working in backend-infra/ or user-infra/.
    skills:
      - my-iac-skill          # skill IDs from the top-level skills array
    tools:
      - search_cdk_docs       # tool IDs from the top-level tools array
      - validate_cfn
    instructions: |
      You are the infra-agent. Work exclusively in backend-infra/ and user-infra/.

  - id: api-agent
    description: Python Lambda and FastAPI specialist. Use for Lambda function work.
    skills:
      - my-serverless-skill
    tools:
      - get_lambda_guidance
      - sam_logs
    instructions: |
      You are the api-agent. Work on Lambda functions only.
```

**Fields:**
- `id` (required): Unique identifier. Used as the MCP key (`capa-{id}`) and agent file name.
- `description` (optional): Role description. For Cursor this drives automatic delegation — be specific.
- `skills` (required): List of skill IDs from the top-level `skills` array.
- `tools` (required): List of tool IDs from the top-level `tools` array. Only these are exposed on the filtered MCP endpoint.
- `instructions` (optional): Markdown text appended to the agent file body.

**Cleanup:** On each `capa install`, sub-agents removed from the config are automatically unregistered and their agent files removed. `capa clean` removes all sub-agent registrations.

For full YAML examples of every skill type, server type, security block, requiresCommands, tool defaults/group, and agents schema, see the original capability file docs or the examples in `references/workflows-and-examples.md`.
