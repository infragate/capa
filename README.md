<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
    <img alt="CAPA" src="assets/banner-light.svg" width="280">
  </picture>
</p>

<h3 align="center">Agentic Capabilities and Package Manager</h3>

<p align="center">
  <a href="https://github.com/infragate/capa/releases/latest"><img src="https://img.shields.io/github/v/release/infragate/capa?style=flat-square&label=latest&color=6366f1" alt="Latest Release"></a>
  <a href="https://github.com/infragate/capa/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/infragate/capa/test.yml?style=flat-square&label=tests&logo=github" alt="Tests"></a>
  <a href="https://github.com/infragate/capa/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/infragate/capa/release.yml?style=flat-square&label=release&logo=github" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <a href="https://github.com/infragate/capa/releases/latest"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platforms"></a>
</p>

CAPA is the package manager for AI coding agents. Declare your skills, tools, rules, sub-agents, MCP servers, and plugins once in `capabilities.yaml`, run `capa install`, and CAPA writes them into Cursor, Claude Code, Codex, Windsurf, GitHub Copilot, and 35+ other agents.

## Why CAPA?

An AI coding agent needs to know when to act and to have the tools to act with. Wiring that up usually means scattering config across half a dozen files: MCP servers in one place, skill markdown in another, team conventions in `CLAUDE.md`, Cursor rules in `.cursor/rules/`, a half-finished onboarding doc somewhere in Notion. Nobody's setup matches anyone else's.

CAPA collapses that into one `capabilities.yaml` next to your code. You list your skills (markdown that tells the agent how to do something), the tools each skill needs (MCP calls and shell commands), your rules, your sub-agents, and any plugins you want pulled in. `capa install` does the rest. Cursor gets `.cursor/rules/`. Claude Code gets `.claude/agents/` and `CLAUDE.md`. Codex gets `AGENTS.md`. Each provider on your list gets the files it expects, with capa-managed marker blocks for the parts it owns.

One file, version controlled, pinned by `capabilities.lock`, cached by SHA. The teammate who clones tomorrow gets the same bytes you got today.

## Screenshots

CAPA is equipped with local web UI. You can visualize your `capabilities.yaml`, browse registries, manage credentials, and see exactly what each agent will receive.

The project view shows installed plugins, configured providers, and your full capability inventory. The bar across the top tracks token savings from `on-demand` tool exposure: the agent sees only the tools it's actively using, and pulls any of the rest in by name when it needs them.

<p align="center">
  <img src="https://github.com/user-attachments/assets/d61b3ecf-1ab1-4965-994c-883b42d8174a" alt="CAPA project view: plugins, providers, skills, tools, and servers" width="900" />
</p>

Scrolling down the same page brings up sub-agents, rules, project options, and credentials. Every entry carries an `INLINE` / `GITHUB` / `REMOTE` badge so you can see at a glance where each one came from.

<p align="center">
  <img src="https://github.com/user-attachments/assets/155f861d-cfc9-47a4-a584-c3d88cb9bc39" alt="CAPA project view: sub-agents, rules, options, and credentials" width="900" />
</p>

The Registries tab pulls skills and plugins from external catalogs. Need a private one? Run `capa registry add owner/repo@my-adapter` (or use the **Manage registries** page). capa fetches the adapter from GitHub, GitLab, or an HTTPS URL, validates it, and it shows up here too.

<table align="center">
  <tr>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/edc5e853-27dc-4671-9866-08c955f684af" alt="CAPA: Cursor Marketplace registry" width="440" /><br/>
      <sub><b>Cursor Marketplace</b></sub>
    </td>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/0ca3e3b6-680d-4e7d-8ea7-6c91fd2dce03" alt="CAPA: skills.sh registry" width="440" /><br/>
      <sub><b>skills.sh</b></sub>
    </td>
  </tr>
</table>

## What it does

- Skills from inline content, raw URLs, GitHub, GitLab, local paths, or a configured registry.
- 35+ supported agents: Cursor, Claude Code, Codex, Windsurf, GitHub Copilot, Cline, Continue, Goose, Gemini CLI, Roo Code, Qwen Code, and more.
- One MCP server per agent. Tools load on demand, so the context window stays small. In our benchmarks that runs 19-40% cheaper than exposing every tool up front, with no drop in quality (150 trials on claude-opus-4-8).
- Any CLI command can be wrapped as an MCP tool the agent (and `capa sh`) can call.
- Rules go to each provider's native location: Cursor `.cursor/rules/`, Windsurf `.windsurf/rules/`, Copilot's instructions file, or a managed marker block in `AGENTS.md` / `CLAUDE.md` for providers without a rules directory. Glob scoping works.
- Lifecycle hooks for providers that support them (Claude Code, Cursor, Codex, Gemini CLI). Declare canonical events like `beforeShell` or `afterFileEdit` once and capa translates them into each provider's hook config (`.claude/settings.json`, `.cursor/hooks.json`, `.codex/config.toml`, `.gemini/settings.json`), tagging each one with `capa:<id>` so user-authored entries are never touched. Providers without hook support emit a warning and skip.
- Sub-agents get their own filtered MCP endpoint that exposes only the tools the specialist actually needs.
- Skills and plugins are browsable from `capa add` and the web UI. Add a registry with `capa registry add owner/repo@my-adapter` (GitHub/GitLab/HTTPS sources, slug auto-derived, adapter validated before install) and it shows up too.
- `capabilities.lock` records resolved commit SHAs. A SHA-keyed content cache makes repeat installs near instant.
- Credentials are encrypted at rest, edited in the web UI, or read from `.env`.
- Blocked-phrase enforcement, tool output sanitisation, and CLI prerequisite checks all run before any install touches your filesystem.
- Private GitHub and GitLab repos work over OAuth.
- The bundled `capabilities-manager` skill teaches the agent how to read and edit its own `capabilities.yaml`.

<p align="center">
  <img width="1305" height="941" alt="CAPA Architecture" src="https://github.com/user-attachments/assets/a4db54a2-6ea5-43df-baa9-c61c189d30c1" />
</p>

## Installation

**macOS and Linux:**
```bash
curl -LsSf https://capa.infragate.ai/install.sh | sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://capa.infragate.ai/install.ps1 | iex"
```

## Quick start

### 1. Initialize your project

```bash
cd your-project
capa init
```

This drops a `capabilities.yaml` next to your code.

### 2. Add a skill

Pull a skill from any public GitHub repo:

```bash
capa add anthropics/skills@frontend-design
```

### 3. Edit `capabilities.yaml`

```yaml
providers:
  - cursor
  - claude-code

skills:
  - id: frontend-design
    type: github
    def:
      repo: anthropics/skills@frontend-design

  - id: web-researcher
    type: inline
    def:
      description: Search the web for fresh information
      requires:
        - "@brave.search"
      content: |
        ---
        name: web-researcher
        description: Use when you need current information from the web.
        ---
        Use `brave.search` and always cite a link.

rules:
  - id: commit-style
    type: inline
    description: Conventional Commits
    alwaysApply: true
    content: |
      Always use Conventional Commits (feat/fix/chore/docs/refactor).
      Subject ≤ 72 chars, imperative mood, no trailing period.

servers:
  - id: brave
    type: mcp
    def:
      cmd: npx -y @modelcontextprotocol/server-brave-search
      env:
        BRAVE_API_KEY: ${BraveApiKey}

tools:
  - id: search
    type: mcp
    description: Search the web with Brave Search
    def:
      server: "@brave"
      tool: brave_web_search
```

### 4. Install

```bash
capa install
```

`capa install` resolves SHAs and downloads anything that isn't already in the cache. It then writes the per-provider files (`.cursor/rules/`, `.claude/agents/`, `AGENTS.md`, and so on) and registers one MCP endpoint with each agent on your list. The resolved SHAs land in `capabilities.lock` so the next clone gets the same bytes.

### 5. Turn any MCP server into a CLI tool

```bash
capa sh                                  # list every configured tool
capa sh brave                            # list brave subcommands
capa sh brave search --query "…"         # run a tool directly
```

Every tool you define is also a CLI command under `capa sh`. MCP tools live at `capa sh <server> <tool>`. Shell tools live at the top level (or under whatever `group` you assigned). 

## Server

CAPA runs a local HTTP server (default `127.0.0.1:5912`) for the web UI, REST API, and MCP endpoints.

When the server binds to a non-loopback address (anything other than `127.0.0.1`, `localhost`, or `::1`), all `/api/*` routes and MCP endpoints require authentication. Loopback-only bindings skip auth entirely.

Set a fixed token with the `CAPA_AUTH_TOKEN` environment variable. If unset on a non-loopback host, CAPA generates a random token at startup, saves it to `~/.capa/auth.token` (mode `0600`), and prints it once to stderr.

Clients must send the token via header (query-string tokens are rejected):

- `Authorization: Bearer <token>` (preferred)
- `X-Capa-Auth-Token: <token>` (fallback)

## Documentation

Guides, the full schema reference, and the registry catalog:

**[https://capa.infragate.ai](https://capa.infragate.ai)**

## License

MIT
