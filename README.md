# CAPA: Agentic Capabilities Manager

[![Latest Release](https://img.shields.io/github/v/release/infragate/capa?style=flat-square&label=latest&color=6366f1)](https://github.com/infragate/capa/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/infragate/capa/test.yml?style=flat-square&label=tests&logo=github)](https://github.com/infragate/capa/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/infragate/capa/release.yml?style=flat-square&label=release&logo=github)](https://github.com/infragate/capa/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/infragate/capa/releases/latest)

**CAPA** is a powerful package manager for AI agents that allows you to define skills and tools, manage credentials, and seamlessly integrate with MCP clients like Cursor and Claude.

## Features

- 🔌 Single MCP server that proxies only the necessary tools
- ⚡ Dynamic on-demand tool loading
- 🖥️ Expose shell commands as MCP tools
- 🔑 Credential management via interactive UI or `.env` file
- 🛡️ Security controls (blocked phrases, character sanitization)
- 📦 Compatible with [skills.sh](https://skills.sh)
- 🤖 Supports Cursor and Claude plugin installation
- 🔒 Installation of skills and plugins from private repositories (GitHub and GitLab)
- 🧠 Self-improving agents

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
        Use the brave_search tool to find current information online.
    requires:
      - brave_search

servers:
  - id: brave
    type: mcp
    def:
      cmd: npx -y @modelcontextprotocol/server-brave-search
      env:
        BRAVE_API_KEY: ${BraveApiKey}

tools:
  - id: brave_search
    type: mcp
    def:
      server: "@brave"
      tool: brave_web_search
```

### 3. Install and launch

```bash
capa install
```

CAPA installs your skills, starts the capability server, and automatically registers with your MCP client (Cursor, Claude Desktop).

## Documentation

For complete guides, examples, and API reference, visit:

**[https://capa.infragate.ai](https://capa.infragate.ai)**

## License

MIT
