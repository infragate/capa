# Discovery search matrix

The exhaustive list of where agent configuration hides on disk. Run these searches in parallel; group findings by category before showing the user.

Always exclude: `node_modules/`, `dist/`, `build/`, `.git/`, `vendor/`, `target/`, `.next/`, `.venv/`, `__pycache__/`.

## MCP servers

| Where | Format | What to extract |
|---|---|---|
| `.cursor/mcp.json` | JSON `{ "mcpServers": { id: { command, args, env } } }` | One server per key |
| `.mcp.json` (project root) | JSON `{ "mcpServers": ... }` | Same shape as Cursor; Claude Code's standard location |
| `mcp.json` (project root, no dot) | JSON | NOT a real provider standard. Usually a duplicate of `.mcp.json` left over from an editor that hid dotfiles. Diff against `.mcp.json` — if identical, recommend removing it; if different, ask which one is authoritative. |
| `.claude/settings.json` → `mcpServers` | JSON map | Same shape |
| `.codex/config.toml` → `[mcp_servers.<id>]` | TOML tables | `command`, `args`, `env` |
| `.gemini/settings.json` → `mcpServers` | JSON map | Same shape |
| `.vscode/mcp.json` | JSON map | Continue / VS Code MCP |
| Any `**/mcp.json` outside the above | JSON | Likely a sub-project or vendored config — flag, don't auto-include |

**HTTP/SSE servers**: when a server entry has `"type": "http"` / `"type": "sse"` and a `"url"`, treat as remote (capa entry: `def.url` + optional `def.headers`). When it has `"command"` and `"args"`, treat as local subprocess (`def.cmd`, `def.args`, optional `def.env`). Don't mix them up — remote servers have no `cmd`, local servers have no `url`.

**Dedup across sources**: when the same id appears in multiple files (e.g., `postgres` in both `.cursor/mcp.json` and `.claude/settings.json`), diff the configs. If identical, emit one entry. If they differ, surface the diff and ask which one is authoritative — don't silently pick one.

Also grep for `mcpServers` inside any `package.json` or `pyproject.toml` — some tools embed MCP config there.

**Normalization rules:**
- Local subprocess: capa entry is `type: mcp` + `def.cmd`, `def.args`, optional `def.env`.
- Remote HTTP: capa entry uses `def.url` + optional `def.headers`.
- Replace literal secrets (anything matching `(?i)(token|key|secret|password|api[_-]?key)`) in env/headers with `${VarName}` placeholders.

## Skills

| Where | Layout |
|---|---|
| `.claude/skills/<id>/SKILL.md` | Per-skill directory |
| `.cursor/skills/<id>/SKILL.md` | Per-skill directory |
| `skills/<id>/SKILL.md` | Shared (already in the target shape) |
| `.codex/skills/<id>/SKILL.md` | Per-skill directory |
| `~/.claude/skills/<id>/SKILL.md` | **User-level** — do NOT vendor. Note it exists; user keeps it. |

Read the frontmatter (`name`, `description`, `requires`) from each `SKILL.md` to populate inventory metadata.

## Rules

| Where | Format | Notes |
|---|---|---|
| `.cursor/rules/**/*.mdc` | Markdown with YAML frontmatter (`description`, `globs`, `alwaysApply`) | Modern Cursor |
| `.cursor/rules/**/*.md` | Same | Older Cursor |
| `.cursorrules` (file at root) | Plain markdown, no frontmatter | Legacy — treat as one `inline` rule with `alwaysApply: true` |
| `AGENTS.md` (root) | Plain markdown | Manages via capa `agents` section, NOT a rule — record separately |
| `CLAUDE.md` (root) | Plain markdown | Same as AGENTS.md — record under `agents.additional` |
| `.github/copilot-instructions.md` | Plain markdown | Treat as an `inline` rule scoped to provider `copilot` |
| `.gemini/GEMINI.md` | Plain markdown | Treat under `agents` for Gemini, not a rule |
| `.codex/AGENTS.md` | Plain markdown | Same as root AGENTS.md |
| `.windsurfrules` | Plain markdown | Legacy Windsurf — inline rule |

When Cursor's `globs` field is present, map it to capa's `appliesTo`. When `alwaysApply: true`, keep it.

## Hooks

| Provider | File | Section |
|---|---|---|
| Claude Code | `.claude/settings.json` | `hooks.<EventName>` → `[{ matcher, hooks: [{ type, command }] }]` |
| Cursor | `.cursor/hooks.json` | `hooks.<eventName>` → array |
| Codex | `.codex/config.toml` | `[[hooks.<EventName>]]` + `[[hooks.<EventName>.hooks]]` |
| Gemini | `.gemini/settings.json` | `hooks.<EventName>` — claude-style |

For each hook entry, capture: event name, matcher (if any), command or script path, timeout.

If the hook references a script file (e.g., `command: "/path/to/script.sh"`), check whether the script is in the repo. If yes, it'll move under `hooks/<id>.sh` and be referenced via `source: { type: local }`. If it's outside the repo, leave it as an inline command pointing at the absolute path and warn the user.

## Sub-agents

| Where | Format |
|---|---|
| `.claude/agents/<id>.md` | Markdown with optional YAML frontmatter (`description`, `tools`) |
| `.cursor/agents/<id>.md` | Same |

Capture id (filename stem), description (frontmatter), tools list, and the body (becomes `instructions`).

## Cursor slash commands (not migratable today)

`.cursor/commands/*.md` are Cursor-specific user-invocable commands. Capa has no equivalent concept. Don't move them, don't reference them in `capabilities.yaml`, but **do** list them in the inventory and the migration summary so the user knows they're staying put. A frequent pattern is a `.cursor/commands/foo.md` that's just a thin wrapper around a skill (often documented in a `.claude/skills/AGENTS.md` mapping table) — note the wrapper relationships when you spot them.

## Plugins

Plugins are rare in pre-capa projects. The signals:

- `.claude/plugins/<name>/` directory with a manifest (`plugin.json`)
- A git submodule whose root contains a manifest matching capa's plugin schema
- A `plugins/` directory at repo root with sub-projects

Don't auto-include plugins — surface them and ask the user. Most "plugins" found in the wild are really just skill collections that should be referenced via `type: github` instead.

## Symbolic links

```
find . -type l -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*'
```

For each symlink:
- Resolve target (`readlink -f` on Linux, `readlink` on macOS — fall back to `python -c "import os; print(os.path.realpath('PATH'))"`)
- Classify: is the target inside the repo, inside the user's home, on a network mount, broken?
- If the symlink IS one of the discovered config dirs (e.g., `.cursor -> ~/dotfiles/cursor`), surface it loudly — moving it would break the user's dotfile setup. Bootstrap should NOT migrate it without explicit instruction.

## Git submodules

```
git submodule status            # `-` prefix means uninitialized
grep -h '^\s*path' .gitmodules  # all submodule paths
```

Submodules are common in large repos — and most of them are application code, not agent config. Don't init all 50+ of them blindly. The cost is real: clones take time, may need different auth (SSH vs HTTPS), and most return nothing.

**Two-pass strategy:**

1. **Shortlist by name.** Match basename or URL repo name against `(skill|agent|prompt|mcp|context)` (case-insensitive). Anything matching probably contains agent config; everything else probably doesn't. Show the shortlist to the user before initializing — they can add more, remove false positives, or say "skip all submodules."

2. **For each shortlisted submodule:**
   - Get the pinned SHA: `git ls-tree HEAD <path>` (the second column is the commit SHA).
   - Init it: `git submodule update --init <path>`. If the clone fails because the URL uses SSH (`git@host:…`) but the user authenticates over HTTPS, retry with `git -c url."https://<host>/".insteadOf="git@<host>:" submodule update --init <path>`.
   - Walk the checked-out tree for `SKILL.md` **at any depth** — `find <path> -name SKILL.md` (do NOT use `-maxdepth`; skills routinely live at `<root>/.claude/skills/<name>/SKILL.md`, which is four levels deep from the submodule root, and a depth limit will miss them).
   - For each `SKILL.md` found, capture: the submodule's remote URL (`git config -f .gitmodules submodule.<name>.url`), the pinned SHA, the path to the skill inside the submodule, and the skill `name` from the SKILL.md frontmatter (this is what `@<basename>` matches against).

3. **Capture each found skill as a remote reference** (NOT vendored). The reason: capa can fetch from private GitLab/GitHub repos using the user's OAuth tokens, and pinning to the same commit the submodule pinned keeps reproducibility identical. The submodule itself becomes redundant for capa purposes — the user may keep it or remove it.

   Reference shape — GitHub:
   ```yaml
   skills:
     - id: my-skill
       type: github
       def:
         repo: owner/repo@my-skill#<sha>            # @ = recursive search by basename
         # or, when the path inside is unambiguous:
         # repo: owner/repo::skills/my-skill#<sha>  # :: = exact path
   ```

   Reference shape — GitLab (note: subgroups are supported):
   ```yaml
   skills:
     - id: my-skill
       type: gitlab
       def:
         repo: group/subgroup/repo@my-skill#<sha>
   ```

4. **Watch for duplicates against local skills.** If a submodule SKILL.md has the same `name` (or directory basename) as a skill you already discovered in `.claude/skills/`, `.cursor/skills/`, or `skills/`, that local copy is almost certainly a vendored copy of the submodule's skill — someone copied it in once and the submodule has since become the source of truth. Surface the conflict to the user with this recommendation:

   > Skill `<name>` exists both at `<local-path>` and at `<submodule>/<sub-path>` pinned to `<sha>`. The submodule is the canonical source; would you like me to delete the local copy and reference the submodule version via `type: gitlab` (or `github`)? This keeps the project lighter and the canonical source authoritative.

   Default to "yes" unless the local copy has clearly diverged (diff the SKILL.md frontmatter and body). If they've diverged, ask which one wins instead of guessing.

5. **Submodules without `SKILL.md`** (init succeeded but the repo had no skills at the pinned commit) — note them in the inventory ("X submodule pinned at <sha> contains no SKILL.md right now; not added to capabilities.yaml") and move on. Don't error out — the submodule may be in flux.

6. **All other submodules** (everything not shortlisted) — summarize in one line in the inventory: "67 other submodules in .gitmodules (mostly data pipelines) — not initialized, not scanned. Re-run with `--all-submodules` if you want exhaustive coverage." Don't list them individually; that's noise.

## Per-project vs per-user

Several providers honor both project-local and user-level configs:

- Claude Code: `.claude/` (project) and `~/.claude/` (user)
- Cursor: `.cursor/` (project) and `~/.cursor/` (user)
- Codex: `.codex/` (project) and `~/.codex/` (user)

Bootstrap **only operates on project-local** configs. Mention user-level configs in the inventory ("FYI: ~/.claude/skills/foo exists, but we won't touch it") so the user knows where their other context comes from, but never vendor user-level items into the project.
