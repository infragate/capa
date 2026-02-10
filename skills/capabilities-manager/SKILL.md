---
name: abilities-manager
description: Guide for managing capabilities, skills, tools, and MCP servers with capa. Use this skill when you need to modify the capabilities.{yaml|json} file.
---

# Abilities Manager

A comprehensive skill for managing agent capabilities using the CAPA (Capabilities Package Manager) CLI. This skill helps agents understand how to define, install, and manage skills, tools, and MCP servers through declarative configuration files.

## When to Use

Use this skill when:
- User wants to initialize a new capabilities file
- User needs to add or manage skills for an agent
- User wants to configure MCP servers and tools
- User asks about capabilities file structure
- User needs to install or clean capabilities
- User wants to find available skills from the skills.sh ecosystem
- User needs to manage the CAPA server (start/stop/restart)

## Core Concepts

### Capabilities File
The `capabilities.json` or `capabilities.yaml` file defines everything an agent can do. It contains four main sections:

1. **clients**: List of MCP clients where skills should be installed (e.g., `cursor`, `claude-code`)
2. **skills**: Modular knowledge packages that teach agents when and how to use tools
3. **servers**: MCP servers that provide tools (local subprocesses or remote HTTP servers)
4. **tools**: Executable capabilities (MCP tools or shell commands)

### Skills vs Tools
- **Skills**: Provide knowledge and context about when/how to use capabilities (non-executable)
- **Tools**: Perform actual operations (API calls, commands, file operations)

## Available Commands

### Initialize Capabilities
```bash
capa init [--format json|yaml]
```
Creates a new `capabilities.json` (or `.yaml`) file with default capabilities.

**When to use**: First-time setup or starting a new project.

### Install Capabilities
```bash
capa install
```
Reads the capabilities file and installs all skills to configured MCP clients. Creates skill directories in `.cursor/skills/` and/or `~/Library/Application Support/Claude/skills/`.

**When to use**: After modifying the capabilities file or adding new skills.

### Clean Managed Files
```bash
capa clean
```
Removes all skill directories and configurations that were installed by CAPA.

**When to use**: Cleaning up before reinstalling or removing CAPA-managed capabilities.

### Find Skills
```bash
npx skills find <query>
```
Search for skills in the skills.sh ecosystem by keyword or domain.

**When to use**: Discovering community skills for specific capabilities.

### Server Management
```bash
capa start              # Start the CAPA server
capa stop               # Stop the CAPA server
capa restart            # Restart the CAPA server
capa start --foreground # Run server in foreground (debugging)
```

**When to use**: Managing the background MCP server that handles tool execution.

## Capabilities File Structure

### Skills Section

Skills can be defined in three ways:

#### 1. Inline Skills
Embed SKILL.md content directly in the capabilities file:

```json
{
  "id": "web-researcher",
  "type": "inline",
  "def": {
    "content": "---\nname: web-researcher\ndescription: Web research skill\n---\n\n# Web Researcher\n\nUse for web research tasks."
  }
}
```

**Best for**: Project-specific skills unique to your workflow.

#### 2. GitHub Skills
Fetch skills from the skills.sh ecosystem:

```json
{
  "id": "find-skills",
  "type": "github",
  "def": {
    "repo": "vercel-labs/agent-skills@find-skills",
    "description": "Discover skills from skills.sh",
    "requires": ["npx_skills_find"]
  }
}
```

**Format**: `owner/repo@skill-name`

**Best for**: Well-maintained community skills from skills.sh.

#### 3. Remote Skills
Fetch SKILL.md from any URL:

```json
{
  "id": "custom-skill",
  "type": "remote",
  "def": {
    "url": "https://example.com/my-skill/SKILL.md",
    "description": "Custom remote skill",
    "requires": ["tool1", "tool2"]
  }
}
```

**Best for**: Private or custom skills hosted elsewhere.

### Servers Section

Define MCP servers that provide tools:

#### Local Server (Subprocess)
```json
{
  "id": "filesystem-server",
  "type": "mcp",
  "def": {
    "cmd": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    "env": {
      "API_KEY": "${ApiKey}"
    }
  }
}
```

#### Remote Server (HTTP)
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

**Variable Substitution**: Use `${VarName}` for credentials. CAPA will prompt for these securely.

### Tools Section

Define tools that skills can use:

#### MCP Tool
Proxy a tool from an MCP server:

```json
{
  "id": "read_file",
  "type": "mcp",
  "def": {
    "server": "@filesystem-server",
    "tool": "read_file"
  }
}
```

**Note**: Use `@server-id` to reference a server from the servers section.

#### Command Tool
Execute shell commands:

```json
{
  "id": "greet_user",
  "type": "command",
  "def": {
    "run": {
      "cmd": "echo Hello, {name}!",
      "args": [
        {
          "name": "name",
          "type": "string",
          "description": "The name to greet",
          "required": true
        }
      ]
    }
  }
}
```

**Optional Init**: Add `"init"` block to run setup commands before first use:

```json
{
  "def": {
    "init": {
      "cmd": "npm install -g some-tool"
    },
    "run": {
      "cmd": "some-tool {arg}"
    }
  }
}
```

## Usage Workflows

### 1. Starting a New Project

```bash
# Initialize capabilities file
capa init --format json

# Edit capabilities.json to add your skills and tools

# Install the capabilities
capa install

# Start the CAPA server
capa start
```

### 2. Adding a Community Skill

```bash
# Find skills
npx skills find "web research"

# Add the skill to capabilities.json:
{
  "id": "web-researcher",
  "type": "github",
  "def": {
    "repo": "vercel-labs/agent-skills@web-researcher",
    "requires": ["brave_search"]
  }
}

# Add required tools/servers

# Install
capa install
```

### 3. Creating a Custom Skill

```bash
# Create skill directory
mkdir -p skills/my-custom-skill

# Create SKILL.md with frontmatter
cat > skills/my-custom-skill/SKILL.md << 'EOF'
---
name: my-custom-skill
description: My custom skill description
---

# My Custom Skill

Detailed description here...
EOF

# Add to capabilities.json as remote or create inline version

# Install
capa install
```

### 4. Managing Server Lifecycle

```bash
# Start server (background)
capa start

# Check if running
curl http://localhost:5912/health

# View logs (if needed)
tail -f ~/.capa/logs/server.log

# Restart after config changes
capa restart

# Stop server
capa stop
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

**capabilities.json:**
```json
{
  "clients": ["cursor"],
  "skills": [
    {
      "id": "web-researcher",
      "type": "inline",
      "def": {
        "description": "Web research using Brave Search",
        "requires": ["brave_search"],
        "content": "---\nname: web-researcher\n---\n\n# Web Researcher\n\nUse brave_search for finding current information on the web."
      }
    }
  ],
  "servers": [
    {
      "id": "brave-search-server",
      "type": "mcp",
      "def": {
        "cmd": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
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
        "server": "@brave-search-server",
        "tool": "brave_web_search"
      }
    }
  ]
}
```

**Setup:**
```bash
capa install  # Will prompt for BraveApiKey
capa start
```

### Example 2: File Operations

**capabilities.json:**
```json
{
  "clients": ["cursor", "claude-code"],
  "skills": [
    {
      "id": "file-manager",
      "type": "github",
      "def": {
        "repo": "vercel-labs/agent-skills@file-operations",
        "requires": ["read_file", "write_file", "list_directory"]
      }
    }
  ],
  "servers": [
    {
      "id": "filesystem-server",
      "type": "mcp",
      "def": {
        "cmd": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\Tony\\Projects"]
      }
    }
  ],
  "tools": [
    {
      "id": "read_file",
      "type": "mcp",
      "def": {
        "server": "@filesystem-server",
        "tool": "read_file"
      }
    },
    {
      "id": "write_file",
      "type": "mcp",
      "def": {
        "server": "@filesystem-server",
        "tool": "write_file"
      }
    },
    {
      "id": "list_directory",
      "type": "mcp",
      "def": {
        "server": "@filesystem-server",
        "tool": "list_directory"
      }
    }
  ]
}
```

### Example 3: Mixed Command and MCP Tools

**capabilities.json:**
```json
{
  "clients": ["cursor"],
  "skills": [
    {
      "id": "hello-world",
      "type": "inline",
      "def": {
        "description": "Basic greeting capabilities",
        "requires": ["hello_world", "greet_user"],
        "content": "---\nname: hello-world\n---\n\n# Hello World\n\nDemonstrates command tools."
      }
    }
  ],
  "servers": [],
  "tools": [
    {
      "id": "hello_world",
      "type": "command",
      "def": {
        "run": {
          "cmd": "echo Hello, World!",
          "args": []
        }
      }
    },
    {
      "id": "greet_user",
      "type": "command",
      "def": {
        "run": {
          "cmd": "echo Hello, {name}!",
          "args": [
            {
              "name": "name",
              "type": "string",
              "description": "Name to greet",
              "required": true
            }
          ]
        }
      }
    }
  ]
}
```

## Troubleshooting

### Server Won't Start
```bash
# Check if port is in use
netstat -ano | findstr :5912

# Check logs
tail -f ~/.capa/logs/server.log

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
ls ~/Library/Application\ Support/Claude/skills/

# Restart MCP client (Cursor or Claude Desktop)
```

### Credentials Not Prompting
- Ensure variables use exact `${VarName}` format
- Check that variables are referenced in server/tool definitions
- Try `capa restart` to reinitialize credential prompt

### MCP Server Crashes
- Check server logs in CAPA's process management
- Verify server command and args are correct
- Ensure required environment variables are set
- Test server command manually outside CAPA

## Tools

This skill requires these tools to function:

- `capa_init` - Initialize capabilities file
- `capa_install` - Install capabilities and skills
- `find_skills` - Search for skills in the ecosystem

## Additional Resources

- **CAPA Documentation**: See project README.md and SKILLS.md
- **Skills.sh Ecosystem**: https://skills.sh
- **MCP Protocol**: https://modelcontextprotocol.io
- **Community Skills**: https://github.com/vercel-labs/agent-skills

## Notes

- CAPA is compatible with the skills.sh standard
- Skills are installed as directories with SKILL.md files
- The CAPA server runs on `http://localhost:5912` by default
- Multi-project support with unique project IDs
- Sessions expire after 1 hour of inactivity
- Tools are lazily initialized on first use
