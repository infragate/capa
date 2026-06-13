---
name: bootstrap
description: Capify an existing project. Scans the repo for already-installed MCP servers, skills, rules, hooks, sub-agents, and plugins (across .claude, .cursor, .codex, .gemini, etc.), consolidates them into shared top-level directories (skills/, rules/, hooks/), and synthesizes a sound capabilities.yaml from the inventory. Use whenever the user says "bootstrap capa", "capify this project", "onboard capa onto an existing repo", "inventory my agent setup", or asks how to turn an ad-hoc Claude/Cursor/Codex configuration into a capabilities file. Use even when the user only mentions one provider — discovery should still sweep all of them.
---

# Bootstrap

Turn an existing project that has accumulated MCP servers, skills, rules, hooks, and sub-agents across several provider-specific directories into a clean, reproducible `capabilities.yaml` managed by capa.

## When to use

The user has a repo that already works with at least one AI coding agent (Claude Code, Cursor, Codex, Gemini, Copilot, etc.) but has never run `capa init`. They want capa to take over so the configuration is shared across providers and version-controlled in one place.

Trigger words and shapes: "bootstrap capa", "capify", "set capa up on this repo", "convert my .claude/.cursor config to capa", "I have a bunch of skills and rules already — onboard them".

If `capabilities.yaml` already exists at the repo root, this skill is the wrong tool — point the user at the `capabilities-manager` skill instead, which knows how to extend an existing file.

## How this relates to `capabilities-manager`

Bootstrap is the one-time on-boarding helper. It produces a `capabilities.yaml` from scratch. `capabilities-manager` is the long-term editor — adding skills, registering MCP servers, configuring hooks on an already-bootstrapped project. **Read `capabilities-manager` for schema details and YAML examples** rather than re-deriving them here; this skill focuses on discovery and migration, and defers all schema questions to it.

When you (the agent) need to know the exact shape of a `skills:` entry, a `hooks:` entry, the canonical event names, the difference between `@` and `::` in `def.repo`, or any other schema-level detail — load the `capabilities-manager` skill rather than guessing. Bootstrap calls schema decisions out by name, but never inlines the schema reference.

## The flow at a glance

1. **Preflight** — verify capa is installed, decide whether to branch, check for an existing `capabilities.yaml`.
2. **Discover** — sweep the repo for every flavor of agent config, including symlinks and submodules.
3. **Plan** — present the inventory to the user, propose moves, get sign-off before touching files.
4. **Migrate** — move provider-specific items into shared top-level dirs.
5. **Synthesize** — write `capabilities.yaml` and update `.gitignore`.
6. **Verify** — run `capa install` and surface anything that didn't take.
7. **Inspect tools** — for each registered MCP server, ask capa what tools it exposes and add the relevant ones to `tools:`. Servers with zero tools usually mean unfinished auth — tell the user and wait.

Each phase is described below. Don't skip a phase; each one's output is the next one's input.

## Phase 1 — Preflight

Before scanning, confirm three things:

**Capa is installed.** Run `capa --version`. If it isn't installed, stop and ask the user to install it (point them at the README); don't attempt to bootstrap blind.

**Git state is sane.** Run `git status --porcelain` and `git rev-parse --abbrev-ref HEAD`. If the working tree has uncommitted changes that aren't agent-config files (i.e., user is mid-edit on real code), tell them and ask whether to proceed; bootstrap will move files and they may want a clean slate first.

**Branch decision.** Look at the current branch:
- If it's `main`, `master`, `trunk`, or matches the repo's default branch (from `git symbolic-ref refs/remotes/origin/HEAD` — fall back to `main` if unset), create a new branch named `capa/bootstrap` (or a unique suffix if that already exists) with `git checkout -b capa/bootstrap`. Bootstrap touches many files; isolating that in a branch makes it trivially revertable.
- If it's anything else, the user is already working on something — stay on that branch and tell them so. Don't switch.

**Existing capabilities file.** If `capabilities.yaml` or `capabilities.json` already exists at the repo root, stop. Tell the user the project is already bootstrapped and they should use `capabilities-manager` to extend it.

## Phase 2 — Discover

Sweep the project for every kind of agent configuration. **Run the searches in parallel** — they're independent and reading them sequentially wastes time on large repos. Always exclude `node_modules`, `dist`, `build`, `.git`, `vendor`, and `target` from globs.

For each category below, also resolve **symlinks** (`find . -type l -not -path './node_modules/*' -not -path './.git/*'`) and check **git submodules** (`git submodule status` — if any submodule is itself an agent-config repo, surface it). A symlinked `.cursor` pointing at `~/dotfiles` is a real finding that affects what you do with it.

See `references/discovery.md` for the exhaustive search matrix — every file glob, every JSON/TOML key, every provider quirk. Use that file rather than memorizing locations; provider directories change and the reference is updated when capa learns a new one.

The shape of the inventory you build should look like:

```
discovered:
  mcp_servers:
    - source: .cursor/mcp.json
      id: postgres
      kind: local-subprocess
      def: { cmd: ..., args: ..., env: ... }
  skills:
    - source: .claude/skills/code-review/SKILL.md
      id: code-review
      provider: claude-code
  rules:
    - source: .cursor/rules/typescript.mdc
      id: typescript
      provider: cursor
      applies_to: ["**/*.ts", "**/*.tsx"]
  hooks:
    - source: .claude/settings.json
      event: PreToolUse
      provider: claude-code
      command: "..."
  subagents:
    - source: .claude/agents/api-reviewer.md
      id: api-reviewer
  symlinks: [...]
  submodules: [...]
  ignored_dirs_present: [".claude", ".cursor"]
```

You don't have to use that exact format — it's a checklist. Whatever you produce should let the user see, at a glance, what's about to be migrated.

## Phase 3 — Plan

Show the inventory to the user. **Before moving any files**, propose:

**Why moves are necessary** (lead with this — users often resist file moves until they understand): capa's install model assumes it owns the provider-specific directories. On every `capa install`, it rewrites `.claude/skills/`, `.cursor/skills/`, etc. from a separate source-of-truth location. If a skill stays under `.claude/skills/` and is also declared as `type: local` pointing at the same dir, install fails with "directory already exists and is not managed by capa." So the source has to live outside provider dirs — that's the whole reason for the move, not aesthetics.

If the project's own conventions designate `.claude/skills/` (or similar provider dir) as the shared canonical location (often documented in an `AGENTS.md` at that path), call that out and explain that the convention worked pre-capa but capa-managed projects need a separate source dir. Offer to update the project's AGENTS.md as part of the migration so it reflects the new layout.

1. **Which items to migrate into shared dirs**, and what they'll become:
   - `.claude/skills/foo/` → `skills/foo/` referenced as `type: local`, `def.path: ./skills/foo`
   - `.cursor/skills/bar/` → `skills/bar/` (or merged with an existing one of the same name; flag the conflict)
   - `.cursor/rules/*.mdc` → `rules/*.md` referenced as `type: inline` (small) or moved with a `path:` (for now, capa supports inline/remote/github/gitlab — there is no `type: local` for rules, so the bootstrap default is `type: inline` with the file content embedded; flag this trade-off with the user if files are large)
   - `.claude/agents/*.md` → entries in the top-level `subagents:` section (capa regenerates the file on install)
   - Hooks in `.claude/settings.json` / `.cursor/hooks.json` → top-level `hooks:` entries, using canonical event names. For non-trivial hook scripts, move the script under `hooks/<id>.sh` and reference via `source: { type: local, path: ./hooks/<id>.sh }`. Inline one-liners stay inline.
   - MCP servers from `.cursor/mcp.json`, `.claude/settings.json` `mcpServers`, `.codex/config.toml` `mcp_servers` → top-level `servers:` entries. Merge duplicates by id; flag mismatched configs (e.g., two providers point a server with the same id at different commands).

2. **Which providers to declare** in `options.providers` (or to omit so capa resolves at install time). Default: declare exactly the providers whose config dirs you found.

3. **Which directories to `.gitignore`** — by default, ignore generated subpaths only:
   ```
   .claude/skills/
   .claude/agents/
   .cursor/skills/
   .cursor/rules/
   .cursor/mcp.json
   ```
   `.claude/settings.json` and `.cursor/settings.json` often contain user-specific bits the user wants to keep editing by hand, so leave them tracked. If the user has nothing hand-authored there, they can broaden to `.claude/` / `.cursor/` themselves.

4. **Conflicts and ambiguities** — call them out explicitly:
   - Two skills with the same name in different provider dirs (likely the same skill installed twice — confirm before merging)
   - A symlinked config dir (user probably wants this preserved, not moved)
   - A rule with provider-specific frontmatter that won't round-trip into capa's inline form (note the loss and ask)
   - A submodule that itself ships skills (probably should become a plugin or a github-typed skill — don't auto-vendor it)

**Wait for confirmation** before Phase 4. The user may want to skip some items, rename others, or change the target layout. Don't move files without sign-off — bootstrap's whole value is being the careful path.

## Phase 4 — Migrate

Execute the plan. Use `git mv` rather than `mv` so history follows the files. Keep moves atomic per category — easier to revert if something looks wrong.

After moving, run `git status` and show the user the rename list so they can spot-check before you write the capabilities file.

## Phase 5 — Synthesize

Compose `capabilities.yaml` at the project root. The skeleton:

```yaml
providers:
  # only the ones actually present in the project
options:
  toolExposure: on-demand
skills:
  - id: capabilities-manager
    type: github
    def:
      repo: infragate/capa@capabilities-manager
      description: Guide for managing capabilities with capa CLI
  # then everything discovered, sorted by id
servers: []
tools: []
rules: []
hooks: []
subagents: []
plugins: []
```

Rules of composition:

- **Always include `capabilities-manager`** so future edits have the schema available to the agent.
- **Sort entries by `id`** within each section. Stable order makes future diffs readable.
- **Don't invent ids.** Use the directory or file basename for discovered items, kebab-cased.
- **For each MCP server**, prefer the most complete config from any source (e.g., if `.cursor/mcp.json` has env vars and `.claude/settings.json` doesn't, take Cursor's). Replace literal secrets with `${VarName}` placeholders and warn the user that capa will prompt for them on `capa install`.
- **For rules**, default to `type: inline` with `content:` — capa doesn't currently have a `type: local` for rules. If the rule file is big (> ~100 lines), ask the user whether to keep it inline (simple) or push it to a github repo (cleaner but requires a follow-up).
- **For hooks**, translate provider event names to canonical names using the table in `references/event-mapping.md`. If a hook's provider event has no canonical mapping, keep the provider-scoped form (`cursor:beforeShellExecution`) — don't drop it.
- **Don't include empty sections** unless they're useful as placeholders. `servers: []` and `tools: []` belong (so users know where to add things); `subagents: []` only belongs if you actually expect them to add some.

For the exact field-by-field shape of every entry type, consult the `capabilities-manager` skill's `references/capabilities-schema.md` — bootstrap should never duplicate that.

Then update `.gitignore` per the plan from Phase 3. Append a clearly-marked block so the user can see what bootstrap added:

```
# Added by capa bootstrap — generated agent configs
.claude/skills/
.claude/agents/
.cursor/skills/
.cursor/rules/
.cursor/mcp.json
```

## Phase 6 — Verify

Run `capa install` and watch the output. Three things to surface to the user:

1. **What got installed** — list of skills/rules/hooks/servers that capa wrote to disk.
2. **Anything blocked** — a forbidden phrase, a missing CLI prerequisite, an unreachable remote. Don't silently swallow these.
3. **What's left to do** — credentials capa will prompt for, optional fields the user might want to fill in (descriptions, sub-agent instructions, etc.).

If install fails, **don't auto-rollback** — the user is on a branch, and the partial state is debuggable. Tell them what failed and let them decide whether to fix forward or `git reset`.

## Phase 7 — Inspect tools and populate `tools:`

Discovered MCP servers are now registered with capa, but the synthesized file has `tools: []`. Capa's server can introspect what each MCP server actually exposes — fill in the `tools:` section from that introspection so the agent has named entries it can require, group, or pre-default.

**Look up the project id.** Capa assigns each project a stable id like `<basename>-<hash>`. `GET http://127.0.0.1:5912/api/projects` returns a `projects` array; match by `path == $(pwd)` and read `.id`.

**For each server in `capabilities.yaml`**, hit:

```
GET http://127.0.0.1:5912/api/projects/<project-id>/servers/<server-id>/tools
```

The response is always `{"tools": [...]}`. Each tool has `name`, `description`, `inputSchema` (and sometimes `outputSchema`, `_meta` with FastMCP tags).

**If the tools array is populated:** add relevant entries to the `tools:` section of `capabilities.yaml`. "Relevant" means: tools the project actually needs based on what the README/AGENTS.md says the project does. Don't dump every tool — a server with 37 tools probably only has 4–8 the project will use. Group related tools by setting a shared `group:` on command-style tools, or just let them sit at the top level for MCP tools. Use the FastMCP `_meta.fastmcp.tags` (when present) as a hint for grouping.

Capa entry shape for an MCP tool:

```yaml
tools:
  - id: create_mr
    type: mcp
    description: Create a GitLab MR. (Short; the agent sees this in tool descriptions.)
    def:
      server: "@gitlab"
      tool: gitlab_create_merge_request
```

The `id` is the local-friendly name the agent uses; `def.tool` is the remote MCP tool name. Skills `require:` the tools with `@<server-id>.<id>`.

**Important — don't repeat the server name in the id.** Capa already groups tools by server: an entry under `@gitlab` shows up in `capa sh` as `gitlab search-projects`, and skills refer to it as `@gitlab.search_projects`. If you write `id: gitlab_search_projects`, you get `gitlab gitlab-search-projects` — noisy and redundant. Pick `id`s that describe the function alone (`search_projects`, `get_mr`, `list_pipelines`), not the server. The same principle applies when the upstream MCP tool name already includes the server prefix (e.g. `gitlab_gatekeeper_searchProjects`): strip the prefix in `id`, keep the full name in `def.tool` since that's what the remote server actually exposes.

**If the tools array is empty (`[]`):** assume the server needs authentication that hasn't been completed yet. Tell the user explicitly:

> The `<server-id>` MCP server returned 0 tools, which usually means authentication isn't done. Complete the auth flow (open the server's web UI, paste an API key, finish OAuth — whatever its README says) and let me know when you're done. I'll re-fetch the tool list and add the relevant ones to `capabilities.yaml`.

Then **wait for the user** to confirm. When they do, re-fetch and proceed. Don't guess at tool names from documentation — the live tool list is the source of truth, and the names sometimes differ from docs.

**After tool inspection is complete**, ensure any skill that declares a `requires:` list points to real `@<server-id>.<tool-id>` entries that now exist in `tools:`. If a discovered local skill required a tool that doesn't show up in any server's tool list, flag it — the skill may have been written against a different version of the server, or the user may need to add a different MCP server.

**Watch for the "declared but unused" trap.** With `options.toolExposure: on-demand` (the default `capa init` writes), capa only exposes tools the agent will see after a skill calls `setup_tools(['<skill>'])`. The exposure list is computed from each skill's `requires:` field — so a tool that's declared in `tools:` but not in any skill's `requires:` ends up invisible to the agent. `capa install` warns about this:

> 13 tool(s) are not exposed to MCP clients (not required by any skill): gitlab.search_projects, gitlab.get_mr, ... Add them to a skill's `requires` list to expose.

If you see that warning, decide with the user: either add `requires:` entries to the relevant local skills (the right answer when the skills clearly use specific tools) or switch `options.toolExposure: expose-all` (the right answer when the project uses many tools ad-hoc and `requires:` would be guesswork). Bootstrap shouldn't silently choose — surface the warning and the options.

## Wrap-up

End with a one-paragraph summary: which branch you're on, what was migrated, what tools got added (and which servers are pending auth), what to do next (commit, `capa restart`, open PR).

## What this skill never does

- **Never edits `capabilities.yaml` after the first write.** Hand off to `capabilities-manager` for ongoing edits.
- **Never deletes the original provider-specific files.** `git mv` moves them; if the user wants the originals back, the rename is in git history.
- **Never bypasses confirmation.** Bootstrap mutates a lot at once; every phase that touches the working tree gets explicit sign-off.
- **Never assumes a single provider.** Even if the user only mentions Cursor, sweep for Claude/Codex/Gemini too — they probably have leftover configs the user forgot about.
- **Never tries to keep skills inside provider dirs.** Even if the project's own AGENTS.md declares `.claude/skills/` as the shared location, capa needs source-of-truth outside provider dirs (see Phase 3). Explain and migrate; don't try to be clever.

## Things capa can't model

When discovery surfaces something capa has no first-class representation for, **note it in the inventory and leave it in place**. Don't try to force a fit. Today this list includes:

- **Cursor slash commands** (`.cursor/commands/*.md`) — Cursor-only feature with no Claude equivalent. Document them in the migration summary and leave the files where they are.
- **Provider-specific permissions blocks** (e.g., `.claude/settings.json` → `permissions.allow`) — capa doesn't write these; tell the user this file stays under their control and only the `mcpServers`/`hooks` sections will be regenerated.
- **Duplicate config files at root** (e.g., both `.mcp.json` and a sibling `mcp.json` with identical content) — flag the duplicate and recommend removing the non-standard one (`mcp.json` is not part of any provider spec; `.mcp.json` is the Claude standard). Show the user the diff before removing.
- **Empty agent-related directories** (e.g., an empty `ai-skills/` left by a partial migration attempt) — surface them; the user may want to delete or keep.
- **Submodules without agent-relevant content** — most submodules in a real repo are application code, not agent configuration. Use the two-pass strategy in `references/discovery.md`: shortlist by name (anything matching `skill|agent|prompt|mcp|context`), init only the shortlist, scan for `SKILL.md`, register as `type: github`/`type: gitlab` pinned to the submodule's commit SHA. Don't list 70+ application-code submodules individually; one summary line is enough.

## References

| Topic | File |
|-------|------|
| Where to look for each kind of config (full search matrix) | `references/discovery.md` |
| Provider event names → canonical hook names | `references/event-mapping.md` |
| Capabilities file schema | (load `capabilities-manager` skill → `references/capabilities-schema.md`) |
| Commands (`capa init`, `capa install`, etc.) | (load `capabilities-manager` skill → `references/commands.md`) |
