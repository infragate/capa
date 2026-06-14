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


https://github.com/user-attachments/assets/98442d19-44c9-43e6-b2c2-88156b189d5e



## Why CAPA?

AI coding agents need rules, tools, and conventions — and right now those live scattered across CLAUDE.md, .cursor/rules/, AGENTS.md, MCP configs, and a half-finished internal doc. No two setups match.

CAPA collapses it into one `capabilities.yaml` next to your code: skills, tools, rules, sub-agents, plugins. capa install fans it out to every provider in its native format — .cursor/rules/ for Cursor, .claude/agents/ and CLAUDE.md for Claude Code, AGENTS.md for Codex, and so on. Capa-managed marker blocks keep your hand-written content untouched.

One file, version controlled, pinned by capabilities.lock, cached by SHA. The teammate who clones tomorrow gets the exact bytes you got today.

## What it does

- One `capabilities.yaml` manages the content for your agent. Write rules, hooks, and tools once — capa runs them natively, supporting 35+ agents (Cursor, Claude Code, Codex, Windsurf, Copilot, Gemini CLI, and more). No more keeping `.cursor/rules/`, `.claude/settings.json`, and `AGENTS.md` in sync by hand.
- 19–40% cheaper inference, same quality. One MCP server per agent, tools lazy-load on demand instead of front-loading the whole catalog. Measured across 150 trials on claude-opus-4-8.
- Sub-agents only see the tools they need. Each gets its own filtered MCP endpoint — so your research sub-agent isn't holding a git push tool it shouldn't touch.

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

This creates a `capabilities.yaml` next to your code.

### 2. Install

```bash
capa install
```

### 3. Boostrap (Optional)
If you are already working on a project, and would like to get all of it's capabilities be managed by CAPA, simply use the `/bootstrap` skill. The agent will scan your project for skills, MCPs, relevant tools, hooks, and rules.

`capa install` resolves SHAs and downloads anything that isn't already in the cache. It then writes the per-provider files (`.cursor/rules/`, `.claude/agents/`, `AGENTS.md`, and so on) and registers one MCP endpoint with each agent on your list. The resolved SHAs land in `capabilities.lock` so the next clone gets the same bytes.

### 4. Use `capa sh`

```bash
capa sh                                  # list every configured tool
capa sh brave                            # list brave subcommands
capa sh brave search --query "…"         # run a tool directly
```

Every tool you define is also a CLI command under `capa sh`. MCP tools live at `capa sh <server> <tool>`. Shell tools live at the top level (or under whatever `group` you assigned). 

## Documentation

Guides, the full schema reference, and the registry catalog:

**[https://capa.infragate.ai](https://capa.infragate.ai/docs/introduction)**

## License

MIT
