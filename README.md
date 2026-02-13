# CAPA: Agentic Capabilities Manager

**CAPA** is a smart tool manager for AI agents that reduces context window bloat and gives agents control over their own toolset.

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

### Initialize your project

```bash
cd your-project
capa init
```

This creates a `capabilities.yaml` file where you define your agent's tools and skills.

### Example capabilities file

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

### Install

```bash
capa install
```

CAPA will install skills, start the server, and automatically register with your MCP client (Cursor, Claude Desktop).

## Documentation

For complete guides, examples, and API reference, visit:

**[https://capa.infragate.ai](https://capa.infragate.ai)**

## License

MIT
