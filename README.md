# CAPA: An Agentic Skills and Tools Package Manager

CAPA is a powerful package manager for AI agents that allows you to define skills and tools, manage credentials, and seamlessly integrate with MCP (Model Context Protocol) clients like Cursor and Claude Desktop.

## Features

- 📦 **Skills Management**: Define and organize agent skills with their required tools
- 🔧 **Flexible Tool Definitions**: Support for both MCP-based tools and CLI commands
- 🔐 **Secure Credential Management**: Built-in web UI for managing API keys and sensitive data
- 🔄 **Session-based Tool Loading**: Dynamically load tools based on active skills
- 🚀 **Auto-managed MCP Servers**: Automatically spawn and manage child MCP server processes
- 💾 **SQLite-backed Storage**: Persistent storage for projects, sessions, and credentials

## Installation

### Prerequisites

- Bun v1.0+ (https://bun.sh)
- macOS or Windows (latest versions)

### Build from Source

```bash
# Clone the repository
git clone <repository-url>
cd capa

# Install dependencies
bun install

# Build the executable
bun run build

# The binary will be at ./dist/capa
# Add it to your PATH for global access
```

## Quick Start

### 1. Initialize a Project

```bash
cd your-project
capa init --format json
```

This creates a `capabilities.json` file (or `capabilities.yaml` if you prefer YAML).

### 2. Define Your Capabilities

Edit `capabilities.json` to define your skills and tools:

```json
{
  "clients": ["cursor", "claude-code"],
  "skills": [
    {
      "id": "web-researcher",
      "type": "inline",
      "def": {
        "description": "Web research and information gathering",
        "requires": ["web_search", "web_scrape"]
      }
    }
  ],
  "servers": [
    {
      "id": "my-mcp-server",
      "type": "mcp",
      "def": {
        "cmd": "npx @modelcontextprotocol/server-brave-search",
        "env": {
          "BRAVE_API_KEY": "${BraveApiKey}"
        }
      }
    }
  ],
  "tools": [
    {
      "id": "web_search",
      "type": "mcp",
      "def": {
        "server": "@my-mcp-server",
        "tool": "brave_web_search"
      }
    },
    {
      "id": "web_scrape",
      "type": "command",
      "def": {
        "init": {
          "cmd": "pip install beautifulsoup4 requests"
        },
        "run": {
          "args": [
            { "name": "url", "type": "string", "required": true }
          ],
          "cmd": "python -c \"import requests; from bs4 import BeautifulSoup; print(BeautifulSoup(requests.get('{url}').text, 'html.parser').get_text())\""
        }
      }
    }
  ]
}
```

### 3. Install

```bash
capa install
```

This will:
- Copy skill definitions to client directories (`.cursor/skills/`, `.claude/skills/`)
- Start the CAPA server (if not running)
- Check for required credentials
- Display your MCP endpoint URL

### 4. Configure Credentials (if needed)

If your tools require credentials, CAPA will display a URL:

```
🔑 Credentials required!
Please open: http://localhost:5912/ui?project=my-project-a3f2
```

Open this URL in your browser and enter the required values (e.g., API keys).

### 5. Add to Your MCP Client

Add the MCP endpoint to your client configuration:

**For Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "capa": {
      "url": "http://localhost:5912/my-project-a3f2/mcp"
    }
  }
}
```

## Capabilities File Structure

### Clients

List of MCP clients where skills should be installed:

```json
"clients": ["cursor", "claude-code"]
```

### Skills

Skills define collections of tools:

```json
{
  "id": "skill-name",
  "type": "inline",  // or "remote"
  "def": {
    "description": "What this skill does",
    "requires": ["tool1", "tool2"]
  }
}
```

For remote skills:
```json
{
  "id": "remote-skill",
  "type": "remote",
  "def": {
    "url": "https://example.com/skills/my-skill.json",
    "requires": []
  }
}
```

### Servers

MCP servers that provide tools:

**Local server (subprocess):**
```json
{
  "id": "my-server",
  "type": "mcp",
  "def": {
    "cmd": "npx @scope/package",
    "args": ["--option", "value"],
    "env": {
      "API_KEY": "${MyApiKey}"
    }
  }
}
```

**Remote server (HTTP):**
```json
{
  "id": "remote-server",
  "type": "mcp",
  "def": {
    "url": "https://api.example.com/mcp",
    "headers": {
      "Authorization": "Bearer ${Token}"
    }
  }
}
```

### Tools

Tools can be MCP-based or command-based:

**MCP Tool:**
```json
{
  "id": "my_tool",
  "type": "mcp",
  "def": {
    "server": "@my-server",
    "tool": "remote_tool_name"
  }
}
```

**Command Tool:**
```json
{
  "id": "my_command_tool",
  "type": "command",
  "def": {
    "init": {
      "cmd": "pip install package",
      "dir": "./tools"
    },
    "run": {
      "args": [
        { "name": "input", "type": "string", "required": true },
        { "name": "format", "type": "string", "required": false }
      ],
      "cmd": "python script.py --input {input} --format {format}",
      "dir": "./tools"
    }
  }
}
```

## Variable Substitution

Use `${VariableName}` in your configuration to reference secure values:

```json
{
  "env": {
    "API_KEY": "${OpenAIKey}",
    "API_URL": "${BaseURL}"
  }
}
```

These values are:
- Never stored in the capabilities file
- Stored securely in the CAPA database
- Managed through the web UI
- Resolved at runtime

## CLI Commands

### `capa init`

Initialize a new capabilities file.

```bash
capa init --format json   # Creates capabilities.json
capa init --format yaml   # Creates capabilities.yaml
```

### `capa install`

Install skills and configure tools.

```bash
capa install
```

### `capa clean`

Remove all managed files (skills copied to client directories).

```bash
capa clean
```

### `capa start`

Start the CAPA server.

```bash
capa start              # Run in background
capa start --foreground # Run in foreground (for debugging)
```

### `capa stop`

Stop the CAPA server.

```bash
capa stop
```

### `capa restart`

Restart the CAPA server.

```bash
capa restart
```

## How It Works

### Architecture

```
┌─────────────────┐
│   MCP Client    │
│ (Cursor, etc.)  │
└────────┬────────┘
         │
         ↓ HTTP (MCP Protocol)
┌─────────────────┐
│  CAPA Server    │
│  (Port 5912)    │
├─────────────────┤
│ Session Manager │
│ Tool Executors  │
│ MCP Proxy       │
└────────┬────────┘
         │
         ├──→ Child MCP Servers (stdio)
         │
         └──→ Command Execution (shell)
```

### The `setup_tools` Tool

Every CAPA MCP endpoint exposes one built-in tool:

```typescript
setup_tools(skills: string[]): void
```

When an agent calls this tool:
1. The specified skills are activated for the session
2. Required tools are loaded
3. A `tools/list_changed` notification is sent
4. The agent can now see and use the skill's tools

### Session Management

- Each MCP client connection creates a session
- Sessions are isolated per project
- Active skills and tools are session-specific
- Sessions expire after 1 hour of inactivity
- Tool initialization state is cached per project

### Tool Initialization

Command-type tools with an `init` block:
- Init runs once (lazily) when the tool is first called
- Init status is cached in the database
- Failed initialization prevents tool usage
- Errors are stored and displayed

## Configuration Files

CAPA stores configuration in `~/.capa/`:

- `settings.json` - Server settings (port, host, etc.)
- `capa.db` - SQLite database (projects, sessions, credentials)
- `server.pid` - Server process ID

### Default Settings

```json
{
  "version": "1.0.0",
  "server": {
    "port": 5912,
    "host": "127.0.0.1"
  },
  "database": {
    "path": "~/.capa/capa.db"
  },
  "session": {
    "timeout_minutes": 60
  }
}
```

## Examples

### Example 1: Simple Web Search Skill

```json
{
  "clients": ["cursor"],
  "skills": [
    {
      "id": "web-search",
      "type": "inline",
      "def": {
        "description": "Web search capability",
        "requires": ["brave_search"]
      }
    }
  ],
  "servers": [
    {
      "id": "brave",
      "type": "mcp",
      "def": {
        "cmd": "npx -y @modelcontextprotocol/server-brave-search",
        "env": {
          "BRAVE_API_KEY": "${BraveApiKey}"
        }
      }
    }
  ],
  "tools": [
    {
      "id": "brave_search",
      "type": "mcp",
      "def": {
        "server": "@brave",
        "tool": "brave_web_search"
      }
    }
  ]
}
```

### Example 2: Python Data Analysis Skill

```json
{
  "clients": ["cursor"],
  "skills": [
    {
      "id": "data-analyst",
      "type": "inline",
      "def": {
        "description": "Data analysis with Python",
        "requires": ["pandas_query", "plot_data"]
      }
    }
  ],
  "servers": [],
  "tools": [
    {
      "id": "pandas_query",
      "type": "command",
      "def": {
        "init": {
          "cmd": "pip install pandas"
        },
        "run": {
          "args": [
            { "name": "file", "type": "string" },
            { "name": "query", "type": "string" }
          ],
          "cmd": "python -c \"import pandas as pd; df = pd.read_csv('{file}'); print(df.query('{query}'))\""
        }
      }
    },
    {
      "id": "plot_data",
      "type": "command",
      "def": {
        "init": {
          "cmd": "pip install matplotlib pandas"
        },
        "run": {
          "args": [
            { "name": "file", "type": "string" },
            { "name": "x", "type": "string" },
            { "name": "y", "type": "string" }
          ],
          "cmd": "python -c \"import pandas as pd; import matplotlib.pyplot as plt; df = pd.read_csv('{file}'); df.plot(x='{x}', y='{y}'); plt.savefig('plot.png')\""
        }
      }
    }
  ]
}
```

## Troubleshooting

### Server won't start

```bash
# Check if port is in use
netstat -an | grep 5912  # macOS/Linux
netstat -an | findstr 5912  # Windows

# Try a different port
# Edit ~/.capa/settings.json and change the port
```

### Tools not loading

1. Check that skills are activated: call `setup_tools` first
2. Verify capabilities file syntax
3. Check server logs: `capa start --foreground`

### Credential issues

1. Open the web UI: `http://localhost:5912/ui?project=<your-project-id>`
2. Verify all variables are filled
3. Check variable names match in capabilities file

### Child MCP server crashes

- CAPA automatically restarts crashed servers
- Check server logs in CAPA output
- Verify server command and environment variables

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Support

For issues and questions, please open a GitHub issue.
