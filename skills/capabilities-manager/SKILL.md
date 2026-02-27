---
name: capabilities-manager
description: Guide for managing capabilities, skills, tools, MCP servers, and agent instruction files (AGENTS.md/CLAUDE.md) with capa. Use this skill when you need to modify the capabilities.yaml or capabilities.json file. Includes security options (blocked phrases, character sanitization) and the agents section for managing AGENTS.md.
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
- User needs to configure security (blocked phrases, character sanitization)
- User wants to manage AGENTS.md or CLAUDE.md content (the `agents` section)

## Core Concepts

### Capabilities File
The `capabilities.yaml` (or `capabilities.json`) file defines everything an agent can do. It contains six main sections:

1. **providers**: List of MCP clients where skills should be installed (e.g., `cursor`, `claude-code`)
2. **options**: Configuration for tool exposure (`toolExposure`) and security (`security`)
3. **skills**: Modular knowledge packages that teach agents when and how to use tools
4. **servers**: MCP servers that provide tools (local subprocesses or remote HTTP servers)
5. **tools**: Executable capabilities (MCP tools or shell commands)
6. **agents**: Manages the content of `AGENTS.md` in the project root (optional)

### Skills vs Tools
- **Skills**: Provide knowledge and context about when/how to use capabilities (non-executable markdown documentation)
- **Tools**: Perform actual operations (API calls, commands, file operations)

### Tool Exposure Modes
- **expose-all** (default): All tools from all skills are exposed immediately when the MCP client connects
- **on-demand**: Tools are only exposed after the agent calls `setup_tools(["skill-id"])`, keeping the initial context clean

### Security Options
Under `options.security` you can configure:
- **blockedPhrases**: Block skill installation if any skill file contains these phrases. Configure inline as a list or via a `.txt` file reference. Omit or comment out to disable.
- **allowedCharacters**: Additional regex character class for characters to allow **beyond** the always-preserved baseline. The baseline (tab, LF, CR, all printable ASCII U+0020–U+007E) is hardcoded and never stripped, so `-`, `:`, `"`, `'`, newlines, and all keyboard symbols are always safe. Use this to permit extra Unicode ranges (e.g. `[\\u00A0-\\uFFFF]` for all Unicode, including emoji). Set to an empty string to apply baseline-only sanitization. Omit or comment out to disable entirely.

Both features can be disabled independently by removing or commenting out each property. Omit the `security` block entirely to disable both. Only properties that are present are applied.

When a blocked phrase is detected during `capa install`, the installation stops immediately and displays which skill (or plugin skill) contains the phrase and what the phrase is. No skills are installed until the issue is resolved.

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
capa install -e             # Load variables from .env file
capa install -e .prod.env   # Load variables from custom env file
capa install --env          # Alternative syntax for -e
```
Reads the capabilities file and:
1. Installs all skills to configured MCP clients (creates skill directories in `.cursor/skills/` and/or `~/Library/Application Support/Claude/skills/`)
2. Installs/updates `AGENTS.md` (always) and `CLAUDE.md` (when `claude-code` is in providers) if the `agents` section is present (downloads base file, upserts/prunes snippets)
3. Configures the CAPA server with your tools and servers
4. Prompts for any required credentials via web UI (unless `-e` flag is used)
5. Registers the project's MCP endpoint in client config files

**Security**: If `options.security` is configured with <code>blockedPhrases</code> or <code>allowedCharacters</code>, the corresponding checks run during installation. Omit or comment out each property to disable it. If a blocked phrase is found, installation stops immediately and reports which skill and phrase caused the block. When <code>allowedCharacters</code> is present, character sanitization runs: the baseline (printable ASCII + standard whitespace) is always preserved, and the value specifies extra Unicode ranges to keep on top of that.

**Flags**:
- `-e, --env [file]`: Load variables from a `.env` file instead of using the web UI
  - Without filename: Uses `.env` in the project directory
  - With filename: Uses the specified file (e.g., `.prod.env`, `.staging.env`)
  - The env file must exist, or the command will fail with an error
  - All required variables must be present in the env file

**When to use**: After modifying the capabilities file or adding new skills.

**Using .env files**:
When your capabilities contain variables like `${BraveApiKey}`, you can provide them via a `.env` file:

```bash
# Create .env file
echo "BraveApiKey=your-api-key" > .env

# Install with env file
capa install -e
```

The env file format:
```
# Comments are supported
BraveApiKey=your-api-key-here
GitHubToken=ghp_token123
DatabaseUrl=postgresql://localhost:5432/db
```

### Add Skills
```bash
capa add <source> [--id <custom-id>]
```
Add a skill from various sources:
- **GitHub**: `capa add owner/repo@skill-name` (e.g. `capa add vercel-labs/agent-skills@web-researcher`)
- **GitLab**: `capa add gitlab:group/repo@skill-name`
- **Remote URL**: `capa add https://example.com/path/to/SKILL.md`
- **Local path**: `capa add ./path/to/skill` — directory must contain `SKILL.md`; stored as type `local` so the file is read on each install

**When to use**: Quickly adding community skills without manually editing the capabilities file.

### Clean Managed Files
```bash
capa clean
```
Removes all skill directories and MCP client configurations that were installed by CAPA. If the capabilities file has an `agents` section, also removes all capa-managed blocks from `AGENTS.md` and `CLAUDE.md` (each file is deleted if it becomes entirely empty after cleaning).

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
providers:
  - cursor
  - claude-code

options:
  toolExposure: expose-all  # or 'on-demand'
  # Optional security (blocked phrases, character sanitization)
  # security:
  #   blockedPhrases: []
  #   # Or load from file: blockedPhrases: { file: "./blocked-phrases.txt" }
  #   allowedCharacters: ""  # "" = baseline only (strips non-ASCII); "[\\u00A0-\\uFFFF]" = allow all Unicode

# Optional: manage AGENTS.md content
# agents:
#   base:
#     ref: https://raw.githubusercontent.com/org/repo/main/AGENTS.md
#   additional:
#     - type: inline
#       id: my_snippet
#       content: "Custom agent instructions here."

skills:
  - id: skill-id
    type: inline|remote|github|gitlab|local
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

Skills can be defined in five ways:

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

**Format**: `owner/repo@skill-name` (where `skill-name` is a subdirectory in the repo). Optional `:version` or `#sha` for pinning.

**Best for**: Well-maintained community skills from skills.sh or other GitHub repositories.

#### 3. GitLab Skills
Fetch skills from a GitLab repository:

```yaml
skills:
  - id: my-skill
    type: gitlab
    def:
      repo: group/subgroup/repo@skill-name
      description: Skill from GitLab
      requires: []
```

**Format**: `group/subgroup/repo@skill-name`. Optional `:version` or `#sha` for pinning.

**Best for**: Private or self-hosted GitLab repositories.

#### 4. Remote Skills
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

#### 5. Local Skills
Reference a skill from a local directory (path relative to project root or absolute). The SKILL.md is read on each `capa install`, so edits are picked up without re-adding.

```yaml
skills:
  - id: my-local-skill
    type: local
    def:
      path: ./skills/my-skill   # or absolute path
      description: Skill from a local directory
      requires: []
```

**Requirements**: The path must point to a directory that contains a `SKILL.md` file.

**Best for**: Project-local skills you edit in the repo, or shared skills in a monorepo subdirectory.

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

For servers that use a self-signed TLS certificate, add `tlsSkipVerify: true` to bypass certificate verification:

```yaml
servers:
  - id: internal-server
    type: mcp
    def:
      url: https://internal.company.com/mcp
      tlsSkipVerify: true
      headers:
        Authorization: Bearer ${InternalToken}
```

**Variable Substitution**: Use `${VarName}` for credentials. CAPA will prompt for these securely via a web UI.

**OAuth2 detection**: At startup, CAPA probes each HTTP server to auto-detect whether it requires OAuth2. This probe is automatically **skipped** for any server that already has an `Authorization` header configured — no unauthenticated request is ever sent to token-authenticated servers. Servers without an `Authorization` header (e.g. Atlassian, Glean) are probed normally so OAuth2 flows can be set up.

### Security Options

Under `options.security`, you can enforce safety during skill installation:

#### Blocked Phrases
Block installation if any skill file (SKILL.md or additional files) contains a forbidden phrase. Omit or comment out to disable. Configure either inline or via file:

**Inline phrases:**
```yaml
options:
  security:
    blockedPhrases:
      - "some-dangerous-command"
```

**Phrases from file (one phrase per line):**
```yaml
options:
  security:
    blockedPhrases:
      file: "./blocked-phrases.txt"
```

The file path is relative to the capabilities file directory. Empty lines are ignored.

#### Character Sanitization
Replace disallowed characters with spaces during installation. Omit or comment out to disable. Useful to restrict skills to safe character sets.

```yaml
options:
  security:
    allowedCharacters: ""              # baseline only: strips non-ASCII Unicode (emoji, etc.)
    # allowedCharacters: "[\\u00A0-\\uFFFF]"  # allow all printable Unicode including emoji
```

**How it works:** A hardcoded baseline—tab, LF, CR, and all printable ASCII (U+0020–U+007E)—is **always preserved** no matter what. Characters like `-`, `:`, `"`, `'`, `\n`, and every keyboard symbol are in the baseline and will never be stripped. The `allowedCharacters` field extends the baseline by specifying **additional** Unicode ranges to keep. Characters outside both the baseline and the extra allowance are replaced with a space.

Only text files (`.md`, `.txt`, `.ts`, `.js`, `.json`, `.yaml`, etc.) are sanitized; other files are copied as-is. Omit or comment out `allowedCharacters` to disable sanitization entirely.

#### Blocked Phrase Detection
When `capa install` detects a blocked phrase, it **stops immediately** and reports:
- Which skill (or skill in plugin) contains it
- The file path
- The forbidden phrase

No further skills are installed until you remove the phrase from the skill or update your security configuration.

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

### Agents Section

The `agents` section manages agent instruction files (`AGENTS.md` and/or `CLAUDE.md`) in the project root. It lets you define a base file and additional snippets that capa appends on `capa install` and removes on `capa clean`.

#### Which files are managed?

capa determines target files automatically from the `providers` list:

| Provider includes | Files written |
|---|---|
| `cursor` only (or other non-Claude providers) | `AGENTS.md` |
| `claude-code` (or any `claude*` provider) | `AGENTS.md` **and** `CLAUDE.md` |

- **`AGENTS.md`** is always written — it is the universal format supported by Cursor, OpenAI Codex, Google Jules, Amp, Warp, and many others.
- **`CLAUDE.md`** is additionally written when a Claude provider is present, because Claude Code reads `./CLAUDE.md` at the project root for persistent project instructions.

Both files receive identical content.

#### How capa tracks ownership

Each snippet capa writes is wrapped in HTML comment markers that are invisible in rendered markdown and ignored by most LLMs:

```markdown
<!-- capa:start:my_snippet_id -->
Content of the snippet goes here.
<!-- capa:end:my_snippet_id -->
```

- `capa install` **upserts** every snippet (adds if missing, replaces if changed) and **prunes** any capa-owned blocks whose id is no longer in the capabilities file.
- `capa clean` strips all capa-owned blocks from every managed file. If a file is empty after stripping, it is deleted.
- The `base` content is written directly without markers — it is not tracked or modified by capa on clean.
- User content written outside capa markers is never touched (when no base is configured).
- The same **security checks** that apply to skills (`options.security.blockedPhrases` and `options.security.allowedCharacters`) are applied to all agent snippet content (base and additional) before it is written.

#### Schema

```yaml
agents:
  # base is optional — seeds AGENTS.md with a file from any supported source
  base:
    ref: https://raw.githubusercontent.com/org/repo/main/AGENTS.md   # remote URL (default)
  # — or — use github/gitlab source (same syntax as additional snippets):
  # base:
  #   type: github
  #   def:
  #     repo: org/repo@AGENTS.md            # owner/repo@filepath
  # base:
  #   type: gitlab
  #   def:
  #     repo: group/repo@AGENTS.md:v1.0.0   # pinned to tag
  additional:         # optional — list of snippets to append
    - type: inline
      id: unique_snippet_id
      content: |
        ## My Custom Instructions
        Always run tests before committing.
    - type: remote
      id: another_snippet
      url: https://raw.githubusercontent.com/org/repo/main/agent-tips.md
    - type: github
      id: shared_tips        # optional — derived from filename if omitted
      def:
        repo: org/repo@AGENTS.md             # owner/repo@filepath
    - type: github
      def:
        repo: org/repo@docs/tips.md:v1.2.0  # pinned to a version tag
    - type: gitlab
      def:
        repo: group/repo@AGENTS.md#abc123def # pinned to a commit SHA
```

#### Snippet types

| Type | Source | Required fields |
|---|---|---|
| `inline` | Literal text in the YAML | `id`, `content` |
| `remote` | Fetched from a raw URL | `id`, `url` |
| `github` | File fetched from a GitHub repository | `def.repo` (`id` optional — derived from filename) |
| `gitlab` | File fetched from a GitLab repository | `def.repo` (`id` optional — derived from filename) |

#### `def.repo` format for github/gitlab

```
owner/repo@filepath
owner/repo@filepath:version
owner/repo@filepath#sha
```

| Part | Description |
|---|---|
| `owner/repo` | GitHub/GitLab repository path (supports nested GitLab groups, e.g. `group/sub/repo`) |
| `@filepath` | Path to the file inside the repository root, e.g. `AGENTS.md` or `docs/tips.md` |
| `:version` | Optional version tag to pin to, e.g. `:v1.2.0` |
| `#sha` | Optional commit SHA to pin to, e.g. `#abc123def` |

When no version or SHA is specified capa fetches from `HEAD` (the default branch).

#### Other fields

| Field | Description |
|---|---|
| `agents.base.ref` | Raw URL of a remote markdown file — used when `type` is `remote` or omitted. Re-running install always re-downloads and refreshes it. |
| `agents.base.type` | `remote` (default when `ref` is set), `github`, or `gitlab`. Use `github`/`gitlab` together with `def.repo`. |
| `agents.base.def.repo` | Repository + file for `github`/`gitlab` base. Same `owner/repo@filepath` format as snippet `def.repo`. |
| `agents.additional[].id` | Unique identifier used as the capa marker id. Required for `inline`/`remote`; optional for `github`/`gitlab` (derived from the filepath, e.g. `docs_tips_md`). |

#### Full example

```yaml
providers:
  - cursor
  - claude-code

agents:
  base:
    ref: https://raw.githubusercontent.com/org/repo/main/AGENTS.md
  additional:
    - type: inline
      id: setup_tools
      content: |
        ## Agent Setup
        After learning a new skill, call the `setup_tools` tool,
        then use `call_tool` to invoke the relevant tool.
    - type: remote
      id: ci_tips
      url: https://raw.githubusercontent.com/org/repo/main/ci-agent-tips.md
    - type: github
      def:
        repo: org/shared-standards@AGENTS.md   # id derived → "AGENTS_md"
    - type: github
      id: pinned_tips
      def:
        repo: org/repo@docs/agent-tips.md:v2.1.0

skills:
  - id: capabilities-manager
    type: github
    def:
      repo: infragate/capa@capabilities-manager
```

Because `claude-code` is in `providers`, running `capa install` produces both `AGENTS.md` and `CLAUDE.md` with identical content:

```markdown
# Project Instructions
…(content from base URL, written as-is)…

<!-- capa:start:setup_tools -->
## Agent Setup
After learning a new skill, call the `setup_tools` tool,
then use `call_tool` to invoke the relevant tool.
<!-- capa:end:setup_tools -->

<!-- capa:start:ci_tips -->
…(content from remote URL)…
<!-- capa:end:ci_tips -->
```

The base content is written **without markers** — it is the document foundation, not a capa-owned block. Re-running `capa install` rewrites the base content and refreshes all snippets. Only the `additional` snippets carry capa markers.

#### No-base usage (snippets only)

If you omit `base`, capa will create blank files (if they don't already exist) and append only the `additional` snippets:

```yaml
agents:
  additional:
    - type: inline
      id: commit_style
      content: "Always use conventional commits: feat/fix/chore/docs/refactor."
```

#### Syncing changes

Running `capa install` again after modifying the `agents` section is the canonical way to sync:
- Added snippets are appended.
- Changed snippet content is updated in place.
- Removed snippet ids are pruned from the file.
- When a base is configured, the entire file is rebuilt from the freshly downloaded base content plus the current snippets.

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

### 3. Adding a Local Skill (file reference)

When the skill lives in the project (e.g. `./my-skill/SKILL.md`), add it by path so it is stored as type `local` and re-read on every install:

```bash
# Add by path (directory must contain SKILL.md)
capa add ./my-skill

# Or manually in capabilities.yaml:
skills:
  - id: my-skill
    type: local
    def:
      path: my-skill    # relative to project root
      description: Local skill from this repo

capa install
```

Edits to `my-skill/SKILL.md` are picked up on the next `capa install`; no need to re-add the skill.

### 4. Creating a Custom Skill (inline)

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

### 5. Managing Server Lifecycle

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
providers:
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
providers:
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
providers:
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
providers:
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

### Installation Blocked: Forbidden Phrase Detected
When you see a red "Installation blocked" message during `capa install`:
- A skill (or skill in a plugin) contains a phrase from your `options.security.blockedPhrases` list
- The message shows the skill ID, file path, and the forbidden phrase
- **Resolution**: Remove the phrase from the skill's files, or remove/comment out <code>blockedPhrases</code> (or change the restriction) in your capabilities file, then run <code>capa install</code> again

### MCP Server: Self-Signed Certificate Error
If you see `SELF_SIGNED_CERT_IN_CHAIN` errors when connecting to an internal server:
- Add `tlsSkipVerify: true` to the server's `def` block in `capabilities.yaml`
- Run `capa install` then `capa restart`
- Only use this for trusted internal servers

### MCP Server: Token Auth Returns Errors During Startup
If a server that uses Bearer token auth (e.g. Databricks, a self-hosted GitLab MCP) reports connection errors at startup:
- Ensure the `Authorization` header is present in `def.headers` — CAPA skips the OAuth2 probe for these servers automatically
- Verify the token stored for `${VarName}` is valid for the specific server URL (wrong-workspace tokens are a common cause of 403 errors)
- Re-set the token with `capa vars set VarName <new-token>` or re-run `capa install -e` with an updated `.env` file

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
- OAuth2 auto-detection is skipped for servers that already have an `Authorization` header — token-based servers are never probed with unauthenticated requests
- Use `tlsSkipVerify: true` on remote server definitions to connect to servers with self-signed TLS certificates
