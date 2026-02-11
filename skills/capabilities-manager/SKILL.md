---
name: capabilities-manager
description: Guide for managing capabilities, skills, tools, and MCP servers with capa. Use this skill when you need to modify the capabilities.yaml or capabilities.json file.
---

# Capabilities Manager

A comprehensive skill for managing agent capabilities using the CAPA (Capabilities Package Manager) CLI. This skill helps agents understand how to define, install, and manage skills, tools, and MCP servers through declarative configuration files.

## When to Use

Use this skill when:
- User wants to initialize a new capabilities file
- User needs to add or manage skills for an agent
- User wants to configure MCP servers and tools
- User asks about capabilities file structure or format
- User needs to install or clean capabilities
- User wants to find available skills from the skills.sh ecosystem
- User needs to manage the CAPA server (start/stop/restart/status)
- User wants to understand tool exposure modes (on-demand vs expose-all)

## Core Concepts

### Capabilities File
The `capabilities.yaml` (or `capabilities.json`) file defines everything an agent can do. It contains five main sections:

1. **clients**: List of MCP clients where skills should be installed (e.g., `cursor`, `claude-code`)
2. **options**: Configuration for tool exposure behavior (`toolExposure`: `expose-all` or `on-demand`)
3. **skills**: Modular knowledge packages that teach agents when and how to use tools
4. **servers**: MCP servers that provide tools (local subprocesses or remote HTTP servers)
5. **tools**: Executable capabilities (MCP tools or shell commands)

### Skills vs Tools
- **Skills**: Provide knowledge and context about when/how to use capabilities (non-executable markdown documentation)
- **Tools**: Perform actual operations (API calls, commands, file operations)

### Tool Exposure Modes
- **expose-all** (default): All tools from all skills are exposed immediately when the MCP client connects
- **on-demand**: Tools are only exposed after the agent calls `setup_tools(["skill-id"])`, keeping the initial context clean

## Available Commands

### Initialize Capabilities
```bash
capa init [--format json|yaml]
```
Creates a new capabilities file with default configuration. Defaults to YAML format if not specified.

**When to use**: First-time setup or starting a new project.

### Install Capabilities
```bash
capa install
```
Reads the capabilities file and:
1. Installs all skills to configured MCP clients (creates skill directories in `.cursor/skills/` and/or `~/Library/Application Support/Claude/skills/`)
2. Configures the CAPA server with your tools and servers
3. Prompts for any required credentials via web UI
4. Registers the project's MCP endpoint in client config files

**When to use**: After modifying the capabilities file or adding new skills.

### Add Skills
```bash
capa add <source> [--id <custom-id>]
```
Add a skill from various sources:
- GitHub: `capa add vercel-labs/agent-skills`
- GitLab: `capa add gitlab:group/repo`
- Git URL: `capa add https://github.com/user/repo.git`
- Local path: `capa add ./path/to/skill`

**When to use**: Quickly adding community skills without manually editing the capabilities file.

### Clean Managed Files
```bash
capa clean
```
Removes all skill directories and MCP client configurations that were installed by CAPA.

**When to use**: Cleaning up before reinstalling or removing CAPA-managed capabilities.

### Server Management
```bash
capa start              # Start the CAPA server (background)
capa stop               # Stop the CAPA server
capa restart            # Restart the CAPA server
capa status             # Check server health and uptime
```

**When to use**: Managing the background MCP server that handles tool execution and credential management.

## Capabilities File Structure

### Basic Structure (YAML)

```yaml
clients:
  - cursor
  - claude-code

options:
  toolExposure: expose-all  # or 'on-demand'

skills:
  - id: skill-id
    type: inline|remote|github
    def:
      # skill definition

servers:
  - id: server-id
    type: mcp
    def:
      # server definition

tools:
  - id: tool-id
    type: mcp|command
    def:
      # tool definition
```

### Skills Section

Skills can be defined in three ways:

#### 1. Inline Skills
Embed SKILL.md content directly in the capabilities file:

```yaml
skills:
  - id: web-researcher
    type: inline
    def:
      description: Web research skill
      requires:
        - brave_search
      content: |
        ---
        name: web-researcher
        description: Web research skill
        ---
        
        # Web Researcher
        
        Use for web research tasks with the brave_search tool.
```

**Best for**: Project-specific skills unique to your workflow.

#### 2. GitHub Skills
Fetch skills from the skills.sh ecosystem or any GitHub repository:

```yaml
skills:
  - id: find-skills
    type: github
    def:
      repo: vercel-labs/agent-skills@find-skills
      description: Discover skills from skills.sh
      requires:
        - npx_skills_find
```

**Format**: `owner/repo@skill-name` (where `skill-name` is a subdirectory in the repo)

**Best for**: Well-maintained community skills from skills.sh or other GitHub repositories.

#### 3. Remote Skills
Fetch SKILL.md from any URL:

```yaml
skills:
  - id: custom-skill
    type: remote
    def:
      url: https://example.com/my-skill/SKILL.md
      description: Custom remote skill
      requires:
        - tool1
        - tool2
```

**Best for**: Private or custom skills hosted elsewhere.

### Servers Section

Define MCP servers that provide tools:

#### Local Server (Subprocess)
```yaml
servers:
  - id: filesystem-server
    type: mcp
    def:
      cmd: npx
      args:
        - -y
        - "@modelcontextprotocol/server-filesystem"
        - /path/to/dir
      env:
        API_KEY: ${ApiKey}
```

#### Remote Server (HTTP)
```yaml
servers:
  - id: remote-server
    type: mcp
    def:
      url: https://api.example.com/mcp
      headers:
        Authorization: Bearer ${Token}
```

**Variable Substitution**: Use `${VarName}` for credentials. CAPA will prompt for these securely via a web UI.

### Tools Section

Define tools that skills can use:

#### MCP Tool
Proxy a tool from an MCP server:

```yaml
tools:
  - id: read_file
    type: mcp
    def:
      server: "@filesystem-server"
      tool: read_file
```

**Note**: Use `@server-id` to reference a server from the servers section.

#### Command Tool
Execute shell commands:

```yaml
tools:
  - id: greet_user
    type: command
    def:
      run:
        cmd: echo Hello, {name}!
        args:
          - name: name
            type: string
            description: The name to greet
            required: true
```

**Optional Init**: Add `init` block to run setup commands before first use:

```yaml
tools:
  - id: my_tool
    type: command
    def:
      init:
        cmd: npm install -g some-tool
      run:
        cmd: some-tool {arg}
        args:
          - name: arg
            type: string
            required: true
```

## Usage Workflows

### 1. Starting a New Project

```bash
# Initialize capabilities file (defaults to YAML)
capa init

# Edit capabilities.yaml to add your skills and tools

# Install the capabilities
capa install

# Server starts automatically - check status
capa status
```

### 2. Adding a Community Skill

```bash
# Option 1: Use capa add command
capa add vercel-labs/agent-skills

# Option 2: Manually add to capabilities.yaml:
skills:
  - id: web-researcher
    type: github
    def:
      repo: vercel-labs/agent-skills@web-researcher
      requires:
        - brave_search

# Add required tools/servers

# Install
capa install
```

### 3. Creating a Custom Skill

Add an inline skill to your `capabilities.yaml`:

```yaml
skills:
  - id: my-custom-skill
    type: inline
    def:
      description: My custom skill description
      requires:
        - my_tool
      content: |
        ---
        name: my-custom-skill
        description: My custom skill description
        ---
        
        # My Custom Skill
        
        Detailed description and usage instructions here...
        
        ## When to Use
        - Situation 1
        - Situation 2

# Install
capa install
```

### 4. Managing Server Lifecycle

```bash
# Check server status
capa status

# Stop server
capa stop

# Start server (background)
capa start

# Restart after config changes
capa restart

# View server logs (stored in ~/.capa/logs/)
```

## Best Practices

### 1. Organize Skills by Domain
Group related skills and tools together:
- Web research skills with search tools
- File management skills with filesystem tools
- Data analysis skills with Python/pandas tools

### 2. Use Descriptive IDs
Choose clear, kebab-case IDs:
- ✅ `web-researcher`, `code-analyzer`, `file-manager`
- ❌ `wr`, `skill1`, `mySkill`

### 3. Document Tool Requirements
Always specify `requires` array in skill definitions to indicate which tools a skill needs.

### 4. Secure Credential Management
- Use `${VarName}` placeholders for sensitive data
- Never commit actual API keys to capabilities files
- CAPA will prompt for credentials and store them securely

### 5. Test Incrementally
After adding new capabilities:
1. Run `capa install`
2. Test with `capa restart`
3. Verify skills are available in your MCP client

### 6. Keep Skills Focused
Each skill should have a single, clear purpose. Split complex workflows into multiple skills.

### 7. Use GitHub Skills for Common Needs
Check the skills.sh ecosystem before creating custom skills. Community skills are well-maintained and tested.

## Examples

### Example 1: Web Research Setup

**capabilities.yaml:**
```yaml
clients:
  - cursor

skills:
  - id: web-researcher
    type: inline
    def:
      description: Web research using Brave Search
      requires:
        - brave_search
      content: |
        ---
        name: web-researcher
        description: Search the web for information
        ---
        
        # Web Researcher
        
        Use brave_search for finding current information on the web.

servers:
  - id: brave-search-server
    type: mcp
    def:
      cmd: npx
      args:
        - -y
        - "@modelcontextprotocol/server-brave-search"
      env:
        BRAVE_API_KEY: ${BraveApiKey}

tools:
  - id: brave_search
    type: mcp
    def:
      server: "@brave-search-server"
      tool: brave_web_search
```

**Setup:**
```bash
capa install  # Will prompt for BraveApiKey via web UI
```

### Example 2: File Operations

**capabilities.yaml:**
```yaml
clients:
  - cursor
  - claude-code

skills:
  - id: file-manager
    type: github
    def:
      repo: vercel-labs/agent-skills@file-operations
      requires:
        - read_file
        - write_file
        - list_directory

servers:
  - id: filesystem-server
    type: mcp
    def:
      cmd: npx
      args:
        - -y
        - "@modelcontextprotocol/server-filesystem"
        - C:\Users\Tony\Projects

tools:
  - id: read_file
    type: mcp
    def:
      server: "@filesystem-server"
      tool: read_file
  
  - id: write_file
    type: mcp
    def:
      server: "@filesystem-server"
      tool: write_file
  
  - id: list_directory
    type: mcp
    def:
      server: "@filesystem-server"
      tool: list_directory
```

### Example 3: Mixed Command and MCP Tools

**capabilities.yaml:**
```yaml
clients:
  - cursor

options:
  toolExposure: on-demand  # Tools only exposed via setup_tools()

skills:
  - id: hello-world
    type: inline
    def:
      description: Basic greeting capabilities
      requires:
        - hello_world
        - greet_user
      content: |
        ---
        name: hello-world
        description: Greeting tools
        ---
        
        # Hello World
        
        Demonstrates command tools for greetings.

servers: []

tools:
  - id: hello_world
    type: command
    def:
      run:
        cmd: echo Hello, World!
        args: []
  
  - id: greet_user
    type: command
    def:
      run:
        cmd: echo Hello, {name}!
        args:
          - name: name
            type: string
            description: Name to greet
            required: true
```

### Example 4: On-Demand Tool Loading

**capabilities.yaml:**
```yaml
clients:
  - cursor

options:
  toolExposure: on-demand

skills:
  - id: researcher
    type: inline
    def:
      requires:
        - brave_search
      content: |
        ---
        name: researcher
        ---
        For research tasks, use brave_search
  
  - id: data-analyst
    type: inline
    def:
      requires:
        - pandas_query
      content: |
        ---
        name: data-analyst
        ---
        For data analysis, use pandas_query

servers:
  - id: brave
    type: mcp
    def:
      cmd: npx
      args:
        - -y
        - "@modelcontextprotocol/server-brave-search"
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
        cmd: python -c "import pandas as pd; df = pd.read_csv('{file}'); print(df.query('{query}'))"
        args:
          - name: file
            type: string
            required: true
          - name: query
            type: string
            required: true
```

With `on-demand` mode, the agent starts with only `setup_tools()` available and calls:
- `setup_tools(["researcher"])` → Loads `brave_search`
- `setup_tools(["data-analyst"])` → Loads `pandas_query`

## Troubleshooting

### Server Won't Start
```bash
# Check server status
capa status

# Check logs
cat ~/.capa/logs/server.log

# Force stop and restart
capa stop
capa start
```

### Skills Not Appearing
```bash
# Ensure installation succeeded
capa clean
capa install

# Verify skill directories exist
ls .cursor/skills/
# On macOS: ls ~/Library/Application\ Support/Claude/skills/

# Check MCP client config
cat .cursor/mcp.json
# On macOS: cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Restart MCP client (Cursor or Claude Desktop)
```

### Credentials Not Prompting
- Ensure variables use exact `${VarName}` format
- Check that variables are referenced in server/tool definitions
- CAPA will automatically open a web UI (http://localhost:5912) during `capa install`
- Try `capa restart` to reinitialize credential prompt

### MCP Server Crashes
- Check server logs: `cat ~/.capa/logs/server.log`
- Verify server command and args are correct
- Ensure required environment variables are set
- Test server command manually outside CAPA
- Check if port 5912 is available

### Tool Not Found Errors
- Verify tool ID matches between skill `requires` and tools section
- Check that server ID in tool definition uses `@` prefix (e.g., `@server-id`)
- Ensure MCP server is running: check `capa status`
- Verify tool name matches the actual tool provided by the MCP server

## Tools

This skill requires these tools to function:

- `capa_init` - Initialize capabilities file
- `capa_install` - Install capabilities and skills
- `find_skills` - Search for skills in the ecosystem (via `npx skills find`)

## Additional Resources

- **CAPA GitHub**: https://github.com/infragate/capa
- **Skills.sh Ecosystem**: https://skills.sh
- **MCP Protocol**: https://modelcontextprotocol.io
- **Community Skills**: https://github.com/vercel-labs/agent-skills

## Notes

- CAPA is compatible with the skills.sh standard
- Skills are installed as directories with SKILL.md files
- The CAPA server runs on `http://localhost:5912` by default
- Multi-project support with unique project IDs
- Sessions expire after 1 hour of inactivity
- Tools are lazily initialized on first use (command tools with `init` blocks)
- Default format is YAML (though JSON is also supported)
- Credentials are securely stored in a local SQLite database at `~/.capa/capa.db`
- Server automatically monitors and restarts crashed MCP subprocesses
