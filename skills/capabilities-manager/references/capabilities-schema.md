# Capabilities File Schema

Full reference for `capabilities.yaml` / `capabilities.json` structure: basic layout, skills (all six types), servers, tools, rules, plugins, security, `requiresCommands`, the `agents` section, and sub-agents.

## Basic Structure (YAML)

```yaml
# providers is optional — when omitted, resolved at install time via
# --provider flag, DB memory from a previous install, or interactive prompt.
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

# rules: [ { id, type, content?, url?, def?, providers?, appliesTo?, alwaysApply?, description? } ]

# plugins: [ { type: remote, def: { uri } } ]

# subagents: [ { id, description?, skills, tools, instructions? } ]
```

## Skills Section (six types)

- **inline**: Embed SKILL.md content in `def.content`. Use `requires: ['@server_id.tool_id']` for MCP tools, plain ID for command tools.
- **github**: `def.repo: owner/repo@skill-name` (search) or `owner/repo::path/to/skill-name` (exact). See "Repo string format" below for details.
- **gitlab**: `def.repo: group/subgroup/repo@skill-name` (search) or `group/subgroup/repo::path/to/skill-name` (exact). Subgroups are supported.
- **remote**: `def.url` to a SKILL.md URL.
- **local**: `def.path` to a directory containing SKILL.md (read on each install).
- **installed**: User installed the skill elsewhere; capa only records it for tool binding. CLI: `capa add <id> --installed [--requires "..."]`.

## Repo string format (`@` vs `::`)

The `def.repo` field used by skills, rules, and agent snippets has two grammars with different resolution semantics:

| Form | Right-hand side | Resolution |
|---|---|---|
| `owner/repo@<name>` | A **basename** (no slashes) | Capa searches the cloned repo recursively for an entry matching `<name>` — a directory containing `SKILL.md` for skills, or a file whose basename equals `<name>` for rules / snippets. |
| `owner/repo::<path>` | An **exact path** from the repo root | No search. The path must point at the right thing exactly: a directory containing `SKILL.md` for skills, or the markdown file for rules / snippets. |

Both forms accept an optional pinning suffix:
- `:version` — tag or branch name (`…@skill:v1.2.0`, `…::rules/git.md:main`)
- `#sha` — full or short commit SHA (`…@skill#abc1234`)

**When to use which:**
- Use `@` when the name is unique inside the repo — most repos have only one `git-conventions/` skill, one `AGENTS.md`, etc.
- Use `::` when (a) the name collides, (b) the repo layout is part of the contract, or (c) you want the reference to fail loudly if the file ever moves.
- Raw URLs translated by capa (e.g. `https://gitlab.com/.../-/raw/main/AGENTS.md`) always resolve as `::` exact paths internally.

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
- **additional**: List of snippets. Each wrapped in `<!-- capa:start:id -->` … `<!-- capa:end:id -->`. Types: `inline` (id, content), `remote` (id, url), `github`/`gitlab` (def.repo; id optional). For `github`/`gitlab` snippets the `def.repo` field follows the [repo string format](#repo-string-format--vs-) above — usually `owner/repo::path/to/file.md` since you almost always know the file's exact location.

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

## Rules Section

Defines rules installed into each provider's rules directory or instructions file.

- **Providers with a rules directory** (e.g. Cursor → `.cursor/rules/`): each rule is written as a separate file with optional YAML frontmatter (`description`, `globs`, `alwaysApply`).
- **Providers without a rules directory** (e.g. Claude Code, Codex): rule content is folded into the provider's instructions file as a capa marker block.

**Fields:**
- `id` (required): Unique identifier, used as filename stem and capa marker id.
- `type` (required): `inline`, `remote`, `github`, or `gitlab`.
- `providers` (optional): Restrict this rule to specific providers. When omitted, applies to all.
- `appliesTo` (optional): Glob patterns for auto-attached rules (maps to Cursor `globs`).
- `alwaysApply` (optional): When `true`, the rule is always loaded regardless of file context.
- `description` (optional): Human-readable description used in frontmatter.
- `content` (inline only): Literal rule content.
- `url` (remote only): Raw URL to fetch (for private repos prefer `type: github`/`gitlab` so capa uses your OAuth token instead of hitting the raw URL).
- `def.repo` (github/gitlab only): Repository reference using the [repo string format](#repo-string-format--vs-). Use `::` for an exact file path (the common case for rules) or `@<basename>` to let capa search recursively.

```yaml
rules:
  - id: code-style
    type: inline
    alwaysApply: true
    description: Project code style guidelines
    content: |
      Use TypeScript strict mode. Prefer const over let.
      Always use explicit return types on exported functions.

  - id: test-patterns
    type: inline
    appliesTo:
      - "**/*.test.ts"
      - "**/*.spec.ts"
    description: Testing conventions
    content: |
      Use describe/it blocks. Prefer toBe over toEqual for primitives.

  - id: typescript-standards
    type: github
    def:
      # Exact path (recommended for rules — file location is part of the contract)
      repo: my-org/standards::rules/typescript.md
    providers:
      - cursor

  - id: git-conventions
    type: gitlab
    alwaysApply: true
    def:
      # Subgroup repo + exact path, pinned to a tag
      repo: acme/platform/data/pipeline::rules/git-conventions.md:v1.2.0

  - id: shared-style
    type: github
    def:
      # Recursive search — works when "style.md" is unique in the repo
      repo: my-org/standards@style.md
```

`capa clean` removes all capa-installed rules. Rules can be scoped per-provider and support the same source types as skills.

## Plugins Section

Remote plugin packages that bundle skills, servers, and tools from a provider manifest.

**Fields:**
- `id` (optional): Stable identifier; derived from name + ref if absent.
- `type` (required): `remote`.
- `def.uri` (required): Plugin URI. Format: `github:owner/repo`, `github:owner/repo:v1.0.0`, or `github:owner/repo#sha`. GitLab URIs also supported (`gitlab:...`).

```yaml
plugins:
  - type: remote
    def:
      uri: github:some-org/my-plugin:v1.0.0

  - type: remote
    def:
      uri: github:another-org/tools-bundle#abc123
```

Plugins are resolved during `capa install`. The plugin manifest is fetched from the repository and its skills, servers, and tools are merged into the capabilities. Plugin-sourced items are tagged with `sourcePlugin` attribution for display.

For full YAML examples of every skill type, server type, security block, requiresCommands, tool defaults/group, rules, plugins, and agents schema, see the original capability file docs or the examples in `references/workflows-and-examples.md`.
