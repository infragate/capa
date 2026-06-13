---
name: capabilities-manager
description: Manage capa CLI configuration — `capabilities.yaml` / `capabilities.json`, skills, MCP servers, tools, hooks, sub-agents, rules, plugins, AGENTS.md / CLAUDE.md, security options, and tool exposure modes. Use whenever the user edits the capabilities file, runs any `capa` command (init, install, add, clean, sh, start/stop/restart/status, auth, upgrade, cache, registry), wires up an MCP server, adds a skill from GitHub / GitLab / a registry / a remote URL / a local path, configures secrets via `${VarName}` placeholders, installs lifecycle hooks, defines sub-agents, or troubleshoots a failed install. Use even when the user only names a fragment ("add a skill", "wire up brave search", "block this phrase in skills") without saying "capa" — if a `capabilities.yaml` or `capabilities.json` lives at the project root, this is almost certainly the right skill. If the project does NOT yet have a capabilities file, point at the `bootstrap` skill instead.
---

# Capabilities Manager

The capa CLI keeps a single source-of-truth file — `capabilities.yaml` (or `.json`) — that describes everything an agent can do in this project: skills, MCP servers, tools, hooks, sub-agents, rules, plugins, and per-provider files (`AGENTS.md`, `CLAUDE.md`). Editing that file and running the right `capa` command is the whole loop.

This skill is the routing layer for that loop. The actual command reference, schema, full YAML examples, and troubleshooting tables live in `references/`. Load the one you need rather than re-deriving its contents — they are kept up to date and are the authoritative source.

## How capa works (one screen)

1. **The file is the source of truth.** `capabilities.yaml` declares what gets installed. Capa never auto-discovers anything from `.claude/`, `.cursor/`, etc. — if it's not in the file, capa won't manage it. (Onboarding an already-configured project is the `bootstrap` skill's job.)
2. **`capa install` writes everything.** Skill directories under each provider, MCP client config (`.mcp.json`, `.cursor/mcp.json`, etc.), `AGENTS.md` / `CLAUDE.md` blocks, hook entries, rules — all rewritten from the file. Anything labeled `name: capa:<id>` is capa's; entries the user authored by hand are left alone.
3. **`capa clean` removes only what capa wrote.** Safe to run; doesn't touch user-authored files or settings entries.
4. **A background server at `localhost:5912`** handles credential prompts, tool execution (`capa sh`), and the MCP endpoints providers connect to. Started by `capa install`; lifecycle is `capa start | stop | restart | status`.
5. **Secrets are `${VarName}` placeholders** anywhere in the file. Capa prompts for them via web UI on install, or loads from `.env` with `capa install -e`.

## Routing — load the reference that matches the task

| If the user is… | Read first | Then |
|---|---|---|
| Running a CLI command (init/install/add/clean/sh/server/auth/cache/registry/upgrade) or asking what flags exist | `references/commands.md` | Run the command and report results |
| Editing the file — adding a skill, server, tool, hook, sub-agent, rule, plugin, agents block, security setting | `references/capabilities-schema.md` | Edit `capabilities.yaml`; run `capa install` |
| Asking how to wire up a common pattern (web search, file ops, on-demand mode, plugins, etc.) | `references/workflows-and-examples.md` | Adapt the closest example |
| Hitting an install error, credential prompt issue, server crash, missing tools, stale cache, TLS error, blocked phrase | `references/troubleshooting.md` | Apply the diagnostic flow listed for that symptom |

The references are sized for selective reads (each ≤ ~600 lines, with table-of-contents at the top of the larger ones). Don't load all four if only one applies.

## Pitfalls worth heading off

These are the mistakes an agent makes when it improvises the YAML instead of consulting the schema. Skim them before writing or editing a capabilities file.

### `@` vs `::` in `def.repo`

The repo string used by `skills`, `rules`, `plugins`, hook sources, and agent snippets has two grammars with different resolution semantics:

- `owner/repo@<basename>` — capa **searches** the repo recursively for an entry matching `<basename>` (a directory containing `SKILL.md` for skills, a file with that basename for rules / snippets). The right-hand side must have no slashes.
- `owner/repo::<exact/path>` — **no search**; the path must point exactly at the right thing from the repo root.

Use `@` when the name is unique and stable. Use `::` when the file location is part of what the user told you (e.g. "the file is at `rules/typescript.md`") or when collisions are possible. Both forms accept pinning: `:v1.2.0` (tag/branch) or `#abc1234` (commit SHA).

### `${VarName}` is a **capa** placeholder, not a shell variable

`${BraveApiKey}` in `capabilities.yaml` is resolved by capa at install time from its credential store or a `.env` file. It has nothing to do with the runtime environment of any spawned process. In particular: **providers do not export tool input as env vars to hooks** — each fired hook receives a JSON payload on **stdin**. If a hook needs to inspect the command being run, write a local script that reads stdin with `jq` (see the hook example in `references/capabilities-schema.md`), not an inline command with `${...}` placeholders expecting the command text to be interpolated.

### Tool naming: `@server.tool` vs plain id

- **MCP tools** are referenced from skills as `@server-id.tool-id` (e.g. `@brave.search`). The `@` distinguishes them from command tools.
- **Command tools** use the plain tool id (`hello_world`, `deploy_service`).
- In `capa sh`, both are slugified to kebab-case (`@gitlab.list_merge_requests` → `capa sh gitlab list-merge-requests`).

When binding tools to skills via `requires:`, mismatching the `@` prefix is the #1 cause of "tool not found" at install time.

### Tool exposure mode shapes everything downstream

`options.toolExposure` has three values and they change what `capa install` writes:

- `expose-all` (default): every tool any active skill requires shows up in the MCP `tools/list`. Simplest.
- `on-demand`: only `setup_tools` and `call_tool` are exposed at startup; the agent activates skills on demand. Keeps the active toolset small for long contexts.
- `none`: capa writes **no** project-local MCP config files at all. The agent is expected to invoke tools via `capa sh <group> <tool>` instead. Useful when policy forbids per-project `.mcp.json` edits.

Pick deliberately — switching modes later cleans up old entries on the next install but the choice colours the install output.

## Conventions that prevent surprises

- **Keep secrets out of the file.** Always use `${VarName}` placeholders; never paste literal API keys. Capa stores values per-project in `~/.capa/capa.db`.
- **Set `requires:` on every skill.** Skills without `requires:` get no tools exposed under `on-demand` and clutter the install warnings under `expose-all`. The `requires:` list is also how capa wires the dependency graph.
- **Prefer `@` for skill repos, `::` for rule / snippet paths.** Skill basenames are usually unique inside a repo; rule files have known paths and you want the install to fail loudly if the file ever moves.
- **Don't repeat the server name in tool ids.** A tool under `@gitlab` should be `id: search_projects`, not `id: gitlab_search_projects` — capa already groups by server, so the prefix becomes noise (`capa sh gitlab gitlab-search-projects`).
- **Test the install loop after every change.** `capa install` is idempotent and surfaces every problem (missing CLI, blocked phrase, unreachable remote, OAuth probe failure). Run it; don't infer.

## After making changes

Most edits follow the same cycle:

1. Edit `capabilities.yaml`.
2. `capa install` — installs/updates everything, prompts for any new credentials.
3. `capa restart` — only needed if you changed server commands, server env vars, or tool exposure mode. Skill content, rule content, hook bodies, and agents-block content all take effect on the next install without a restart.
4. Verify in the client (Cursor reloads; Claude Code reloads on next session start) or with `capa sh <group> <tool> --help` to confirm the tool is registered.

If an install fails or behaves unexpectedly, jump directly to `references/troubleshooting.md` — the symptoms there are indexed by what the user actually sees in the terminal.

## References

| Need | File | Notes |
|---|---|---|
| Every `capa` command and flag, with concrete invocations | `references/commands.md` | Includes `.env` flow, provider resolution rules, registry adapters |
| Field-by-field schema for skills / servers / tools / hooks / sub-agents / rules / plugins / security / `agents` | `references/capabilities-schema.md` | Includes the `@` vs `::` table and the tool exposure matrix |
| End-to-end YAML examples for the most common patterns | `references/workflows-and-examples.md` | Web research, file ops, on-demand loading, plugins, optional providers |
| Symptoms → diagnoses for install / server / credential / tool failures | `references/troubleshooting.md` | Indexed by the error message the user sees |

External: [CAPA on GitHub](https://github.com/infragate/capa) · [skills.sh registry](https://skills.sh) · [MCP protocol](https://modelcontextprotocol.io)
