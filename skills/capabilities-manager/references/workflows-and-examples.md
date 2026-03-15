# Usage Workflows and Examples

## Contents

- **Workflows**: 1. Starting a New Project · 2. Adding a Community Skill · 3. Adding a Local Skill · 4. Creating a Custom Skill (inline) · 5. Running Tools with `capa sh` · 6. Managing Server Lifecycle
- **Examples**: 1. Web Research Setup · 2. File Operations · 3. Mixed Command and MCP Tools · 4. On-Demand Tool Loading · 5. CLI Prerequisites

---

## Workflows

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
        - '@brave.search'

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
        - '@my-server.my_tool'
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

### 5. Running Tools with `capa sh`

Once the project is installed and the server is running, any configured tool can be called directly:

```bash
# Explore what's available
capa sh
capa sh gitlab
capa sh gitlab list-merge-requests --help

# Execute a tool
capa sh gitlab list-merge-requests --project-id 123 --state opened

# Top-level command tool
capa sh find-skills --query "git automation"

# Pass through an OS command
capa sh git log --oneline
```

Tool IDs are slugified automatically: `list_merge_requests` → `list-merge-requests`.

### 6. Managing Server Lifecycle

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

---

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
        - '@brave-search-server.search'
      content: |
        ---
        name: web-researcher
        description: Search the web for information
        ---
        
        # Web Researcher
        
        Use brave-search-server.search for finding current information on the web.

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
  - id: search
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
        - '@filesystem-server.read_file'
        - '@filesystem-server.write_file'
        - '@filesystem-server.list_directory'

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
        Command tools use their plain ID (e.g. hello_world, greet_user).

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
        - '@brave.search'
      content: |
        ---
        name: researcher
        ---
        For research tasks, use brave.search
  
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
  - id: search
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
- `setup_tools(["researcher"])` → Loads `brave.search`
- `setup_tools(["data-analyst"])` → Loads `pandas_query`

### Example 5: CLI Prerequisites

**capabilities.yaml:**
```yaml
providers:
  - cursor

options:
  requiresCommands:
    - cli: docker
      description: Required to build and run containers
    - cli: kubectl
      description: Kubernetes CLI for cluster management
    - cli: helm

skills:
  - id: k8s-deployer
    type: inline
    def:
      description: Deploy services to Kubernetes
      requires:
        - deploy_service
      content: |
        ---
        name: k8s-deployer
        description: Deploy and manage Kubernetes workloads
        ---
        
        # Kubernetes Deployer
        
        Use deploy_service to deploy a Helm chart to a cluster.

servers: []

tools:
  - id: deploy_service
    type: command
    description: Deploy a Helm chart to the current kubectl context
    def:
      run:
        cmd: helm upgrade --install {release} {chart} --namespace {namespace} --create-namespace
        args:
          - name: release
            type: string
            description: Helm release name
            required: true
          - name: chart
            type: string
            description: Chart reference (e.g. oci://registry/chart)
            required: true
          - name: namespace
            type: string
            description: Target Kubernetes namespace
            required: true
```

Running `capa install` first checks that `docker`, `kubectl`, and `helm` are available. If any command is missing, installation stops with a clear error listing the missing tools.
