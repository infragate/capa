# CAPA: Agentic Capabilities Manager

**CAPA** is a smart tool manager for AI agents that reduces context window bloat and gives agents control over their own toolset.

## Why CAPA?

**The Problem:** Traditional MCP setups expose all tools at once, overwhelming the agent's context window and making it harder to focus on the task at hand.

**The Solution:** CAPA lets agents dynamically load only the tools they need, when they need them. One MCP server, different tools per session.

### Key Benefits

🎯 **Reduced Context Window**  
Only expose relevant tools per session. The agent requests capabilities on-demand instead of having dozens of tools loaded upfront.

🔄 **Multiple Profiles**  
Define different capability profiles (e.g., "web-research", "data-analysis"). The agent switches between them automatically based on the task.

✅ **No Missing Tools**  
Define capabilities once, run everywhere. Share configurations with your team—no more "tool not found" errors across different machines.

🧠 **Self-Improvement**  
Agents can detect missing capabilities and update the capabilities file, learning which tools they need over time.

💚 **Health Monitoring**  
CAPA automatically monitors and restarts MCP servers if they crash, ensuring tools are always available.

## Installation

**macOS and Linux:**
```bash
curl -LsSf https://capa.infragate.ai/install.sh | sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://capa.infragate.ai/install.ps1 | iex"
```

> For advanced options, see [INSTALL.md](INSTALL.md)

## Quick Start

### 1. Initialize

```bash
cd your-project
capa init
```

This creates a `capabilities.yaml` file where you define your agent's tools and skills.

### 2. Define Capabilities

Here's a minimal example with web search:

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

### 3. Install

```bash
capa install
```

CAPA will:
- Install skills to your client (e.g., `.cursor/skills/`)
- Start the CAPA server
- Prompt for credentials if needed (opens a web UI)
- Display your MCP endpoint URL

### 4. Configure Your MCP Client

**Good news!** `capa install` automatically registers with supported clients (Cursor, Claude Desktop). 

If you need to verify or manually configure, the entry in `.cursor/mcp.json` looks like:

```json
{
  "mcpServers": {
    "capa-your-project-id": {
      "url": "http://localhost:5912/your-project-id/mcp"
    }
  }
}
```

Note the key format is `capa-${projectId}`, allowing multiple CAPA projects in the same client.

### 5. Use It

The agent now sees a single tool: `setup_tools(skills: string[])`. When it calls:

```typescript
setup_tools(["web-researcher"])
```

CAPA dynamically loads the `brave_search` tool. The agent's context stays clean until tools are actually needed.

## How It Works

CAPA acts as an intelligent proxy between your MCP client and multiple tool sources:

```
┌─────────────┐
│ MCP Client  │  (e.g., Cursor)
└──────┬──────┘
       │ Sees only: setup_tools()
       ↓
┌─────────────┐
│ CAPA Server │  Manages tool lifecycle
└──────┬──────┘
       │ Exposes tools on demand
       ├──→ MCP Server 1
       ├──→ MCP Server 2
       └──→ Command Tools
```

**Initial state:** Agent sees one tool: `setup_tools(skills: string[])`

**After calling `setup_tools(["web-researcher"])`:** Agent now sees all tools defined in that skill (e.g., `brave_search`)

**Benefits:**
- Context stays clean until tools are needed
- Agent chooses which capabilities to activate
- Multiple skill profiles can coexist

## Examples

### Example 1: Web Research

```yaml
providers:
  - cursor

skills:
  - id: web-research
    type: inline
    def:
      content: |
        ---
        name: web-research
        description: Search and scrape web content
        ---
        Use brave_search to find information and web_scrape to extract content.

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
  
  - id: web_scrape
    type: command
    def:
      init:
        cmd: pip install beautifulsoup4 requests
      run:
        args:
          - name: url
            type: string
            required: true
        cmd: python -c "import requests; from bs4 import BeautifulSoup; print(BeautifulSoup(requests.get('{url}').text, 'html.parser').get_text())"
```

### Example 2: Multiple Profiles

```yaml
providers:
  - cursor

skills:
  - id: researcher
    type: inline
    def:
      content: |
        ---
        name: researcher
        ---
        For research tasks: use brave_search
  
  - id: data-analyst
    type: inline
    def:
      content: |
        ---
        name: data-analyst
        ---
        For data analysis: use pandas_query and plot_data

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
  
  - id: pandas_query
    type: command
    def:
      init:
        cmd: pip install pandas
      run:
        args:
          - name: file
            type: string
          - name: query
            type: string
        cmd: python -c "import pandas as pd; df = pd.read_csv('{file}'); print(df.query('{query}'))"
  
  - id: plot_data
    type: command
    def:
      init:
        cmd: pip install matplotlib pandas
      run:
        args:
          - name: file
            type: string
          - name: x
            type: string
          - name: y
            type: string
        cmd: python -c "import pandas as pd; import matplotlib.pyplot as plt; df = pd.read_csv('{file}'); df.plot(x='{x}', y='{y}'); plt.savefig('plot.png')"
```

The agent can call `setup_tools(["researcher"])` or `setup_tools(["data-analyst"])` based on the task.

## Adding Skills from GitHub

You can quickly add skills from the [skills.sh](https://skills.sh) ecosystem:

```bash
# Add a skill from GitHub
capa add vercel-labs/agent-skills

# Add and customize the ID
capa add vercel-labs/agent-skills --id my-skill
```

## CLI Reference

```bash
capa init                    # Create capabilities.yaml
capa install                 # Install skills and start server
capa install -e              # Install with variables from .env file
capa install -e .prod.env    # Install with variables from custom env file
capa add <source>            # Add skill from GitHub/GitLab/URL
capa clean                   # Remove installed skills
capa start                   # Start CAPA server
capa stop                    # Stop CAPA server
capa restart                 # Restart CAPA server
capa status                  # Check server health status
```

## Secure Credentials

Use `${VariableName}` in your config for API keys:

```yaml
servers:
  - id: brave
    type: mcp
    def:
      cmd: npx -y @modelcontextprotocol/server-brave-search
      env:
        BRAVE_API_KEY: ${BraveApiKey}
```

### Option 1: Web UI (Default)
CAPA will prompt you with a web UI to enter these values securely. They're stored in a local database, never in the config file.

### Option 2: Environment File
You can also provide credentials via a `.env` file during installation:

```bash
# Create a .env file
echo "BraveApiKey=your-api-key-here" > .env

# Install with environment variables
capa install -e
```

Or use a custom env file name:

```bash
capa install -e .prod.env
```

**Note:** If you use the `-e` or `--env` flag, the specified env file must exist, or installation will fail with a clear error message.

## Learn More

- **[Full Documentation](https://capa.infragate.ai)** - Complete guides and API reference

## Contributing

Contributions welcome! Open an issue or PR on [GitHub](https://github.com/infragate/capa).

## License

MIT
