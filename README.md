<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
    <img alt="CAPA" src="assets/banner-light.svg" width="280">
  </picture>
</p>

<h3 align="center">The package manager for AI coding agents</h3>

<p align="center">
  <a href="https://github.com/infragate/capa/releases/latest"><img src="https://img.shields.io/github/v/release/infragate/capa?style=flat-square&label=latest&color=6366f1" alt="Latest Release"></a>
  <a href="https://github.com/infragate/capa/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/infragate/capa/test.yml?style=flat-square&label=tests&logo=github" alt="Tests"></a>
  <a href="https://github.com/infragate/capa/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/infragate/capa/release.yml?style=flat-square&label=release&logo=github" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <a href="https://github.com/infragate/capa/releases/latest"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platforms"></a>
</p>

<p align="center">
  <a href="#why-capa">Why</a> ·
  <a href="#features">Features</a> ·
  <a href="#installation">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#capa-wrap">Wrap</a> ·
  <a href="#web-ui--observability">Web UI</a> ·
  <a href="#documentation">Docs</a>
</p>

Declare skills, tools, rules, sub-agents, MCP servers, hooks, and plugins once in `capabilities.yaml`. Run `capa install`. CAPA writes them into Cursor, Claude Code, Codex, Windsurf, GitHub Copilot, and 35+ other agents — native formats, pinned SHAs, zero manual sync.

https://github.com/user-attachments/assets/98442d19-44c9-43e6-b2c2-88156b189d5e

## Why CAPA?

Agent config today is scattered across `CLAUDE.md`, `.cursor/rules/`, `AGENTS.md`, MCP JSON, hooks, and skill folders. No two teammates match. Nothing is pinned. Cloning the repo does not clone the agent setup.

CAPA collapses that into one version-controlled file next to your code:

- **`capabilities.yaml`** — source of truth for every capability
- **`capabilities.lock`** — SHA pins so tomorrow's clone gets the same bytes
- **Marker blocks** — surgical writes that leave hand-edited content alone
- **One MCP endpoint** — agents talk to CAPA; CAPA proxies upstream servers on demand

The teammate who clones tomorrow gets the exact setup you have today.

## Features

- **One file → 35+ agents** — write once; CAPA fans out to each provider's native layout (`.cursor/rules/`, `.claude/agents/`, `AGENTS.md`, …)
- **Cheaper inference, same quality** — on-demand tool loading instead of front-loading the whole catalog (**19–40%** fewer tokens across 150 trials on claude-opus-4-8)
- **`capa wrap`** — run Cursor, Claude, Codex, and more from a shadow workspace so provider dirs never touch your real repo
- **Local Web UI** — interactive capabilities editor with live YAML sync, registry browse, OAuth setup, and drag-to-reorder
- **Activity traces** — live feed of every MCP call, shell tool, and agent span on the project page
- **Plugins that unpack** — Claude and Cursor plugins decompose into skills, MCP, rules, sub-agents, and hooks
- **Registries** — browse skills.sh, Cursor Marketplace, Claude plugins, and Claude marketplace catalogs
- **`capa add --passthrough`** — write provider-native files directly when you want unmanaged one-offs
- **Sub-agent isolation** — each sub-agent gets a filtered MCP endpoint, so research agents never inherit a `git push` tool

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

### 1. Initialize

```bash
cd your-project
capa init
```

Creates `capabilities.yaml` and registers the project with the local CAPA server (default `http://localhost:5912`).

### 2. Add capabilities

```bash
capa add vercel-labs/agent-skills@web-researcher
capa add --server --id brave --cmd npx --arg @brave/brave-search-mcp
capa registry search skills-sh "research"
```

### 3. Install

```bash
capa install
```

Resolves SHAs, fills the cache, writes per-provider files, and registers one MCP endpoint with each configured agent. Resolved SHAs land in `capabilities.lock`.

> [!TIP]
> Already have skills, MCP configs, and rules in the repo? After `capa init`, use the bundled `/bootstrap` skill — the agent scans the project and drafts the CAPA config for you.

### 4. Run tools from the terminal

```bash
capa sh                                  # list every configured tool
capa sh brave                            # list brave subcommands
capa sh brave search --query "…"         # run a tool directly
capa sh --raw brave search --query "…"   # skip per-tool formatters
```

Every tool you define is also a CLI command under `capa sh`.

### 5. Open the Web UI

```bash
capa status    # prints the local URL when the server is up
```

Edit skills, tools, rules, hooks, plugins, and agents in the browser. Changes sync live back to `capabilities.yaml`.

## `capa wrap`

Run an agent **without polluting your repo** with `.cursor/`, `.claude/`, and friends. CAPA builds a shadow workspace under `~/.capa/workspaces/`, symlinks your project (minus provider-owned paths), installs capabilities into the shadow, and launches the agent.

```bash
capa wrap cursor          # Cursor GUI — stops when the window closes
capa wrap claude          # Claude Code (aliases: claude-code)
capa wrap agent           # Cursor CLI
capa wrap codex
capa wrap gemini-cli
capa wrap opencode

capa wrap cursor --print-dir   # print shadow path, then launch
capa wrap --prune              # clean stale workspaces
capa stop                      # stop server + active wrap sessions
```

**Wrappable today:** Claude Code, Codex, Cursor, Gemini CLI, OpenCode, iFlow CLI, Kiro CLI, Qwen Code, Kimi CLI.

> [!NOTE]
> On Windows, creating the shadow workspace may require [Developer Mode](https://learn.microsoft.com/windows/apps/get-started/enable-your-device-for-development) (or an elevated shell) for symlinks. GitHub Copilot is not wrappable yet — it owns shared `.github/` / `.vscode/` trees that need subpath exclusions.

## Web UI & observability

The embedded React UI (served by the local server) covers the full project lifecycle:

| Area | What you get |
| --- | --- |
| **Capabilities editor** | Skills, tools, rules, hooks, sub-agents, plugins, agents — CRUD, local file pickers, drag reorder |
| **Registries** | Search seeded catalogs (skills.sh, Cursor Marketplace, Claude plugins) and add your own |
| **Activity** | Live tool-call feed, charts, and run timelines (default-on via `options.agentActivity`) |
| **Variables / OAuth** | Credential setup when install needs secrets |

Activity is powered by system hooks and the MCP proxy tracer — MCP failures show as error rows, shell tools from `capa sh` are labeled correctly, and secrets in args/results are redacted.

## Plugins & registries

Plugins are not opaque blobs. CAPA clones the repo, reads Claude (`.claude-plugin/`) or Cursor (`.cursor-plugin/`) manifests, and merges skills, MCP servers, rules, sub-agents, and hooks into the same install pipeline as everything else.

```bash
capa add owner/repo --plugin --install
capa add cursor-marketplace:some-plugin --plugin

capa registry list
capa registry add anthropics/claude-plugins-official --type claude-marketplace
capa registry search skills-sh "typescript"
```

> [!IMPORTANT]
> Most registry adapters are executable TypeScript fetched into `~/.capa/registries-managed/`. Review the source before enabling a third-party registry. Claude marketplaces are JSON catalogs only — safer by design.

## Passthrough mode

Need a one-off native write without CAPA managing the file?

```bash
capa add owner/repo@skill --passthrough --provider cursor
capa add --rule --id ts-strict --inline "Always use strict TypeScript" --passthrough
capa install --passthrough
```

Passthrough skips `capabilities.yaml`, the lockfile, and managed-file tracking. Tool aliases, defaults, and formatters still require managed mode (`capa add --tool … --passthrough` is refused).

## How it fits together

```
capabilities.yaml  ──►  capa install  ──►  provider files (.cursor/, .claude/, AGENTS.md, …)
        │                      │
        │                      ├── capabilities.lock
        │                      ├── ~/.capa/cache/          (content-addressed snapshots)
        │                      └── ~/.capa/db.sqlite       (projects, variables, activity)
        │
        └──► Web UI editor ◄──► file watcher ◄──► disk

Agent ──MCP──► capa server (:5912) ──proxy──► upstream MCP (stdio / HTTP / SSE)
                     │
                     ├── on-demand tools (setup_tools / call_tool)
                     ├── per-sub-agent filtered endpoints
                     └── ToolCallTracer → activity feed
```

## CLI cheat sheet

```bash
capa init                              # create capabilities.yaml + register project
capa add <source> [--plugin] [--install]
capa add --server|--tool|--rule|--hook …
capa install [-p <provider>] [-e .env] [--no-cache]
capa wrap <provider> [--project <path>]
capa sh [tool] [args…] [--raw]
capa registry search|add|list|refresh|remove …
capa start|stop|restart|status
capa clean                             # remove managed artifacts
capa auth github|gitlab
capa cache | capa cache clean
capa upgrade
```

## Documentation

Guides, the full schema reference, and the registry catalog:

**[https://capa.infragate.ai](https://capa.infragate.ai/docs/introduction)**

Maintainer-oriented internals (install pipeline, provider matrix, lockfile semantics) live in [`docs/`](./docs/README.md).
