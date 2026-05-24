# Provider docs

One markdown file per AI agent provider supported by capa, plus the
[compatibility matrix](#compatibility-matrix) at the top of this page.
Every page is the human-readable view of a single entry in
[`src/shared/providers/registry.ts`](../../src/shared/providers/registry.ts);
the registry remains the source of truth.

These pages are organised so a maintainer (or an LLM) can load just the
provider they care about and have the full context for it — registry
shape, doc citations, caveats, and held-back work items — without
scanning a 400-line catch-all.

For the install/clean pipeline, plugin discovery flow, and other
system-level concerns, see [`../README.md`](../README.md).

## Compatibility matrix

What capa actually does for each feature depends on which optional fields
are set on the `ProviderIntegration` entry in
[`src/shared/providers/registry.ts`](../../src/shared/providers/registry.ts).
The shape of each field is documented in
[`src/types/providers.ts`](../../src/types/providers.ts). Click any
provider name in the table for the per-provider page with sources and
caveats.

### How to read this table

- `Skills` is the on-disk skills tree capa copies into.
- `MCP` is the project-local server config (when a provider only supports
  global / IDE-only MCP, it's marked `—`).
- `Instructions` is the markdown file capa writes managed marker blocks
  into (in addition to the universal `AGENTS.md` that every project always
  gets).
- `Rules` and `Sub-agents` are the per-feature directories (or "folded"
  if rules go into the instructions file).

> Plugins are intentionally **not** a column. Capa never installs a
> plugin manifest into a user's project — it parses upstream plugin
> repos and decomposes them into the same skill/rule/server/tool
> primitives shown here, which then flow through these same per-provider
> write paths. See
> [Plugin discovery and unpack](../README.md#plugin-discovery-and-unpack)
> for the actual flow.

**Bold** rows have full integration (project-local MCP + instructions +
at least one of {rules, sub-agents}). Unmarked rows have partial
integration. Rows whose "Skills" column is the only thing populated are
included for completeness but lack any project-local write paths.

| Provider | Skills | MCP | Instructions | Rules | Sub-agents |
| --- | --- | --- | --- | --- | --- |
| [AdaL (`adal`)](./adal.md) | `.adal/skills/` | — *(CLI-managed)* | `AGENTS.md` | — | — |
| [Amp (`amp`)](./amp.md) | `.agents/skills/` | — *(needs nested-key support)* | — | — | — |
| [Antigravity (`antigravity`)](./antigravity.md) | `.agent/skills/` | — *(IDE has none; CLI uses `serverUrl`)* | `AGENTS.md` | `.agents/rules/*.md` | — |
| [Augment (`augment`)](./augment.md) | `.augment/skills/` | — *(global only)* | `AGENTS.md` | — | `.augment/agents/*.md` |
| **[Claude Code (`claude-code`)](./claude-code.md)** | `.claude/skills/` | `.mcp.json` → `mcpServers.capa.url` | `CLAUDE.md` | `.claude/rules/*.md` (yaml: `paths`) | `.claude/agents/*.md` *(+ snippet in `CLAUDE.md`)* |
| [Cline (`cline`)](./cline.md) | `.cline/skills/` | — *(global only)* | `AGENTS.md` | — | — |
| [CodeBuddy (`codebuddy`)](./codebuddy.md) | `.codebuddy/skills/` | `.mcp.json` → `mcpServers.capa.url` *(CLI only)* | `CODEBUDDY.md` | — | — |
| **[Codex (`codex`)](./codex.md)** | `.agents/skills/` | `.codex/config.toml` → `mcp_servers.capa.url` *(TOML)* | `AGENTS.md` | folded into `AGENTS.md` | `.codex/agents/*.toml` *(body in `developer_instructions`)* |
| [Command Code (`command-code`)](./command-code.md) | `.commandcode/skills/` | — | — | — | — |
| [Continue (`continue`)](./continue.md) | `.continue/skills/` | — *(YAML format unsupported)* | — | — | — |
| **[Crush (`crush`)](./crush.md)** | `.crush/skills/` | `.crush.json` → `mcp.capa.url` *(`mcp` key, not `mcpServers`)* | `AGENTS.md` | folded into `AGENTS.md` | — |
| **[Cursor (`cursor`)](./cursor.md)** | `.cursor/skills/` | `.cursor/mcp.json` → `mcpServers.capa.url` *(`purgeStaleSubAgentMcp`)* | `AGENTS.md` | `.cursor/rules/*.mdc` (yaml: `description`, `globs`, `alwaysApply`) | `.cursor/agents/*.md` |
| **[Droid (`droid`)](./droid.md)** | `.factory/skills/` | `.factory/mcp.json` → `mcpServers.capa.url` | `AGENTS.md` | folded into `AGENTS.md` | `.factory/droids/*.md` |
| **[Gemini CLI (`gemini-cli`)](./gemini-cli.md)** | `.agents/skills/` | `.gemini/settings.json` → `mcpServers.capa.httpUrl` *(note `httpUrl`)* | `AGENTS.md` | folded into `AGENTS.md` | `.gemini/agents/*.md` |
| **[GitHub Copilot (`github-copilot`)](./github-copilot.md)** | `.agents/skills/` | `.vscode/mcp.json` → `servers.capa.url` *(`servers` key)* | `.github/copilot-instructions.md` | `.github/instructions/*.instructions.md` (yaml: `applyTo`) | `.github/agents/*.md` *(+ snippet in `copilot-instructions.md`)* |
| [Goose (`goose`)](./goose.md) | `.goose/skills/` | — *(global only)* | `AGENTS.md` | — | — |
| [iFlow CLI (`iflow-cli`)](./iflow-cli.md) | `.iflow/skills/` | `.iflow/settings.json` → `mcpServers.capa.url` | `AGENTS.md` | — | — |
| **[Junie (`junie`)](./junie.md)** | `.junie/skills/` | `.junie/mcp/mcp.json` → `mcpServers.capa.url` | `AGENTS.md` | folded into `AGENTS.md` | `.junie/agents/*.md` |
| **[Kilo Code (`kilo`)](./kilo.md)** | `.kilocode/skills/` | `.kilocode/mcp.json` → `mcpServers.capa.url` *(legacy path, still loaded)* | `AGENTS.md` | `.kilo/rules/*.md` (no frontmatter) | `.kilo/agent/*.md` |
| [Kimi Code CLI (`kimi-cli`)](./kimi-cli.md) | `.agents/skills/` | — *(global only)* | `AGENTS.md` | — | — |
| **[Kiro CLI (`kiro-cli`)](./kiro-cli.md)** | `.kiro/skills/` | `.kiro/settings/mcp.json` → `mcpServers.capa.url` | `AGENTS.md` | `.kiro/steering/*.md` (frontmatter TBD) | — |
| **[Kode (`kode`)](./kode.md)** | `.kode/skills/` | `.mcp.json` → `mcpServers.capa.url` | `AGENTS.md` | folded into `AGENTS.md` | `.kode/agents/*.md` |
| [MCPJam (`mcpjam`)](./mcpjam.md) | `.mcpjam/skills/` | — *(not an agent; testing harness)* | — | — | — |
| [Mistral Vibe (`mistral-vibe`)](./mistral-vibe.md) | `.vibe/skills/` | — *(TOML array-of-tables unsupported)* | `AGENTS.md` | — | — |
| [Mux (`mux`)](./mux.md) | `.mux/skills/` | — *(bare-command strings, no URL field)* | — | — | — |
| [Neovate (`neovate`)](./neovate.md) | `.neovate/skills/` | `.neovate/config.json` → `mcpServers.capa.url` | — | — | — |
| [OpenClaw (`openclaw`)](./openclaw.md) | `skills/` | — *(home-workspace based)* | — | — | — |
| **[OpenCode (`opencode`)](./opencode.md)** | `.agents/skills/` | `.opencode/opencode.json` → `mcp.capa.url` *(`mcp` key)* | `AGENTS.md` | folded into `AGENTS.md` | `.opencode/agents/*.md` |
| [OpenHands (`openhands`)](./openhands.md) | `.openhands/skills/` | — *(global only)* | `AGENTS.md` | — | — |
| [Pi (`pi`)](./pi.md) | `.pi/skills/` | — *(community extension only)* | `AGENTS.md` | — | — |
| **[Pochi (`pochi`)](./pochi.md)** | `.pochi/skills/` | `.pochi/config.jsonc` → `mcp.capa.url` *(JSONC; `mcp` key)* | `README.pochi.md` | folded into `README.pochi.md` | `.pochi/agents/*.md` |
| [Qoder (`qoder`)](./qoder.md) | `.qoder/skills/` | — *(UI-managed)* | `AGENTS.md` | `.qoder/rules/*.md` (behavior set in IDE) | `.qoder/agents/*.md` |
| **[Qwen Code (`qwen-code`)](./qwen-code.md)** | `.qwen/skills/` | `.qwen/settings.json` → `mcpServers.capa.url` | `AGENTS.md` | folded into `AGENTS.md` | `.qwen/agents/*.md` |
| [Replit (`replit`)](./replit.md) | `.agents/skills/` *(hidden from universal list)* | — *(UI-only)* | `replit.md` | — | — |
| **[Roo Code (`roo`)](./roo.md)** | `.roo/skills/` | `.roo/mcp.json` → `mcpServers.capa.url` | — | — | — |
| **[Trae (`trae`)](./trae.md)** | `.trae/skills/` | `.trae/mcp.json` → `mcpServers.capa.url` *(user opt-in required)* | `AGENTS.md` | `.trae/rules/*.md` (no frontmatter) | — |
| **[Trae CN (`trae-cn`)](./trae-cn.md)** | `.trae/skills/` | `.trae/mcp.json` → `mcpServers.capa.url` *(user opt-in required)* | `AGENTS.md` | `.trae/rules/*.md` (no frontmatter) | — |
| **[Windsurf (`windsurf`)](./windsurf.md)** | `.windsurf/skills/` | — | — | `.windsurf/rules/*.md` (yaml: `description`, `globs`, `trigger: always_on \| model_decision`) | — |
| [Zencoder (`zencoder`)](./zencoder.md) | `.zencoder/skills/` | — *(UI-managed; rules format unverified)* | — | — | — |

### Hooks integration

Hooks are intentionally absent from the matrix above because only a small
slice of providers wire them up. The four providers below have a `hooks`
integration in `registry.ts` today — capa edits the file in-place using
`name: capa:<id>` (or `id: <hook-id>` for TOML) tags so it can update or
remove its own entries without touching user-authored ones. Every other
provider triggers a one-shot warning and skips; `capa install` never
fails because of an unsupported hook target.

| Provider | Config file | Shape |
| --- | --- | --- |
| **[Claude Code (`claude-code`)](./claude-code.md)** | `.claude/settings.json` → `hooks` | JSON map (event → `[{ matcher, hooks: [...] }]`) |
| **[Codex (`codex`)](./codex.md)** | `.codex/config.toml` → `[hooks]` | TOML tables, ID-tagged |
| **[Cursor (`cursor`)](./cursor.md)** | `.cursor/hooks.json` (standalone) | `{ version: 1, hooks: { ... } }` envelope |
| **[Gemini CLI (`gemini-cli`)](./gemini-cli.md)** | `.gemini/settings.json` → `hooks` | JSON map (claude-style) |

Materialised hook scripts (when the YAML uses `source: { type: inline /
remote / github / gitlab }`) live under `~/.capa/hooks/<projectId>/<hookId>`
rather than in the project. `source: { type: local }` is special: the
script already exists in the project, so capa references it in place via
its absolute path — no copy under `~/.capa`, `chmod` is the user's
responsibility, edits take effect without re-running `capa install`, and
`capa clean` never deletes it. The `managed_hooks` SQLite table tracks
`(projectId, providerId, hookId, configPath, locator, scriptPath)` so
prune and clean can edit a single entry surgically; `scriptPath` is null
for inline-command hooks and for `local`-source hooks.

See [`docs/README.md`](../README.md#installation-pipeline) for how
`prune-orphan-hooks` and `install-hooks` slot into the install pipeline,
and the per-provider pages above for citations to each provider's hooks
documentation.

### Cross-cutting notes

- **`AGENTS.md` is universal.** Every install run touches `AGENTS.md`
  if any provider is active — `getTargetFilenames` adds it
  unconditionally (`agents-file.ts`). Providers with their own
  `instructions.filename` get the same marker blocks duplicated into
  that file.
- **Sub-agent MCP entries** are only written for providers whose
  `mcp.supportsSubAgentEntries === true`. Cursor and GitHub Copilot opt
  out (Cursor additionally has `purgeStaleSubAgentMcp` to clean up
  stragglers). All other MCP-integrated providers opt in.
- **Tools** (MCP + command) are validated by the local server during
  `configure-tools`, not by the provider — there is no per-provider
  divergence in how `tools:` entries are handled. They're exposed to
  clients via the single capa MCP endpoint registered for each provider
  that has an `mcp` integration.

## Providers by integration tier

> "Full" = project-local MCP + instructions file + at least one of
> {rules, sub-agents}. Source-of-truth definitions in `registry.ts`.

### Full integration

- [Claude Code (`claude-code`)](./claude-code.md)
- [Codex (`codex`)](./codex.md)
- [Crush (`crush`)](./crush.md)
- [Cursor (`cursor`)](./cursor.md)
- [Droid (`droid`)](./droid.md)
- [Gemini CLI (`gemini-cli`)](./gemini-cli.md)
- [GitHub Copilot (`github-copilot`)](./github-copilot.md)
- [Junie (`junie`)](./junie.md)
- [Kilo Code (`kilo`)](./kilo.md)
- [Kiro CLI (`kiro-cli`)](./kiro-cli.md)
- [Kode (`kode`)](./kode.md)
- [OpenCode (`opencode`)](./opencode.md)
- [Pochi (`pochi`)](./pochi.md)
- [Qwen Code (`qwen-code`)](./qwen-code.md)
- [Roo Code (`roo`)](./roo.md)
- [Trae (`trae`)](./trae.md)
- [Trae CN (`trae-cn`)](./trae-cn.md)
- [Windsurf (`windsurf`)](./windsurf.md)

### Partial integration

Project-local file conventions exist for some — but not all — of MCP /
instructions / rules / sub-agents. Capa writes what it can.

- [AdaL (`adal`)](./adal.md)
- [Antigravity (`antigravity`)](./antigravity.md)
- [Augment (`augment`)](./augment.md)
- [Cline (`cline`)](./cline.md)
- [CodeBuddy (`codebuddy`)](./codebuddy.md)
- [Goose (`goose`)](./goose.md)
- [iFlow CLI (`iflow-cli`)](./iflow-cli.md)
- [Kimi Code CLI (`kimi-cli`)](./kimi-cli.md)
- [Mistral Vibe (`mistral-vibe`)](./mistral-vibe.md)
- [Neovate (`neovate`)](./neovate.md)
- [OpenHands (`openhands`)](./openhands.md)
- [Pi (`pi`)](./pi.md)
- [Qoder (`qoder`)](./qoder.md)
- [Replit (`replit`)](./replit.md)

### Held back — needs infrastructure changes

Official project-local config conventions exist, but the current
`ProviderIntegration` / writer abstraction can't express them yet.

- [Amp (`amp`)](./amp.md)
- [Continue (`continue`)](./continue.md)
- [Mux (`mux`)](./mux.md)
- [Zencoder (`zencoder`)](./zencoder.md)

### Not integrated

- [Command Code (`command-code`)](./command-code.md)
- [MCPJam (`mcpjam`)](./mcpjam.md)
- [OpenClaw (`openclaw`)](./openclaw.md)

## Per-provider page conventions

Every provider page follows the same structure:

1. **Status banner** — integration tier, skills dir, link to upstream docs.
2. **Capa integration** — a small table of `Feature → Path → Notes`
   covering Skills, MCP, Instructions, Rules, Sub-agents, and Plugin
   manifests. Use `—` when capa intentionally does not write that feature
   for the provider (with a parenthetical reason).
3. **Caveats** *(optional)* — provider-specific quirks worth surfacing
   in PRs or UX.
4. **Sources** — official doc URLs backing every claim on the page.
5. **Verification footer** — "Last verified: YYYY-MM-DD". Update when
   you re-check the upstream docs.

When you add a new provider, copy any existing page as a starting point
and follow the same headings. The registry entry, the per-provider file,
and the row in the [compatibility matrix](#compatibility-matrix) must
all stay in sync.

## Research methodology

The initial provider integration data was gathered through five parallel
research passes, each one targeting a slice of the registry's skills-only
entries. Each pass was instructed to:

1. Find each provider's **official** documentation (vendor docs site or
   the project's own GitHub README — not third-party blogs).
2. Identify the project-local file paths for MCP, instructions, rules,
   sub-agents, and plugin manifests.
3. Distinguish project-local from global-only / UI-managed config — capa
   only writes project-local files.
4. Cite a source URL for every claim.
5. Mark anything not confirmed from official sources as "unverified" or
   "Not documented".

The five batches covered:

- **Batch 1** (popular): Cline, Continue, Gemini CLI, Goose, Amp
- **Batch 2** (next-tier): Augment, OpenHands, Qwen Code, Junie, Crush
- **Batch 3** (newer / regional): Trae, Trae CN, CodeBuddy, Antigravity,
  Kilo Code, Kode, Droid
- **Batch 4a** (long tail): iFlow CLI, Kimi CLI, Kiro CLI, Mux, Neovate,
  MCPJam, OpenClaw
- **Batch 4b** (long tail): Pi, Pochi, Mistral Vibe, Qoder, Replit,
  Zencoder, AdaL

When a provider's docs change (or we discover an integration we missed),
the workflow is:

1. Update the provider's page in this folder with the new source URL and
   bump the "Last verified" date.
2. Mirror the change in `src/shared/providers/registry.ts`.
3. Mirror the change in the [compatibility matrix](#compatibility-matrix)
   row above.
4. Add or amend the assertion in
   [`src/shared/providers/__tests__/registry.test.ts`](../../src/shared/providers/__tests__/registry.test.ts)
   under the "Expanded provider integrations" describe block.
