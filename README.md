# CAPA: Agentic Capabilities Manager

[![Latest Release](https://img.shields.io/github/v/release/infragate/capa?style=flat-square&label=latest&color=6366f1)](https://github.com/infragate/capa/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/infragate/capa/test.yml?style=flat-square&label=tests&logo=github)](https://github.com/infragate/capa/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/infragate/capa/release.yml?style=flat-square&label=release&logo=github)](https://github.com/infragate/capa/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/infragate/capa/releases/latest)

**CAPA** is a powerful capabilities manager for AI agents that allows you to define skills and tools, manage credentials, and seamlessly integrate with agents like Cursor and Claude.

## Why CAPA?

AI agents need two things to be useful: *knowledge* of when and how to act, and the *ability* to actually do it. Most setups treat these separately — tools are wired up in one place, instructions scattered somewhere else. CAPA brings them together as a single unit called a **capability**.

- **Skills** provide the knowledge — markdown documents that give an agent context, instructions, and decision-making guidance for a specific task.
- **Tools** provide the ability — executable functions the agent calls to interact with the world: APIs, shell commands, file operations, and more.

A tool without knowledge leaves the agent unsure when to use it. Knowledge without tools leaves the agent unable to act. CAPA pairs them declaratively in a single `capabilities.yaml` file that you can version-control, share across a team, and reproduce on any machine.

## Features

- 🔌 Single MCP server that proxies only the necessary tools
- ⚡ Dynamic on-demand tool loading
- 🖥️ Expose shell commands as MCP tools
- 💻 Run any configured tool from the terminal with `capa sh`
- 🔑 Credential management via interactive UI or `.env` file
- 🛡️ Security controls (blocked phrases, character sanitization)
- 📦 Compatible with [skills.sh](https://skills.sh)
- 🤖 Supports Cursor and Claude plugin installation
- 🔒 Installation of skills and plugins from private repositories (GitHub and GitLab)
- 🧠 Self-improving agents
- 🎯 Default argument values for MCP tools
- 🔧 CLI prerequisite verification before installation

<img width="1305" height="941" alt="CAPA Architecture" src="https://github.com/user-attachments/assets/a4db54a2-6ea5-43df-baa9-c61c189d30c1" />

## Installation

**macOS and Linux:**
```bash
curl -LsSf https://capa.infragate.ai/install.sh | sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://capa.infragate.ai/install.ps1 | iex"
```

## Quick Start

### 1. Initialize your project

```bash
cd your-project
capa init
```

This creates a `capabilities.yaml` file where you define your agent's tools and skills.

### 2. Define your capabilities

```yaml
providers:
  - cursor

skills:
  - id: web-researcher
    type: inline
    def:
      content: |
        ---
        name: web-researcher
        description: Search the web for information
        ---
        Use the brave.search tool to find current information online.
    requires:
      - "@brave.search"

servers:
  - id: brave
    type: mcp
    description: Brave web search
    def:
      cmd: npx -y @modelcontextprotocol/server-brave-search
      env:
        BRAVE_API_KEY: ${BraveApiKey}

tools:
  - id: search
    type: mcp
    description: Search the web using Brave Search
    def:
      server: "@brave"
      tool: brave_web_search
```

### 3. Install and launch

```bash
capa install
```

CAPA installs your skills, starts the capability server, and automatically registers with your MCP client (Cursor, Claude Desktop).

### 4. Run tools from the terminal

```bash
capa sh                                  # list all available commands
capa sh brave                            # list brave subcommands
capa sh brave search --query "…"         # run a tool directly
```

`capa sh` turns every configured tool into a CLI command. MCP tools are exposed as `server_name.tool_name` and grouped under their server ID in the CLI. Command tools appear at the top level (or under a custom `group`). Any unrecognised command is passed through to the OS shell.

## Documentation

For complete guides, examples, and API reference, visit:

**[https://capa.infragate.ai](https://capa.infragate.ai)**

## License

MIT
