# Command Reference

## Contents

- Initialize Capabilities · Install Capabilities · Add Skills · Clean Managed Files · Shell / Tool Executor · Server Management

---

## Initialize Capabilities

```bash
capa init [--format json|yaml]
```

Creates a new capabilities file with default configuration. Defaults to YAML format if not specified.

**When to use**: First-time setup or starting a new project.

---

## Install Capabilities

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

**Security**: If `options.security` is configured with `blockedPhrases` or `allowedCharacters`, the corresponding checks run during installation. Omit or comment out each property to disable it. If a blocked phrase is found, installation stops immediately and reports which skill and phrase caused the block. When `allowedCharacters` is present, character sanitization runs: the baseline (printable ASCII + standard whitespace) is always preserved, and the value specifies extra Unicode ranges to keep on top of that.

**Flags**:
- `-e, --env [file]`: Load variables from a `.env` file instead of using the web UI
  - Without filename: Uses `.env` in the project directory
  - With filename: Uses the specified file (e.g., `.prod.env`, `.staging.env`)
  - The env file must exist, or the command will fail with an error
  - All required variables must be present in the env file

**When to use**: After modifying the capabilities file or adding new skills.

### Using .env files

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

---

## Add Skills

```bash
capa add <source> [--id <custom-id>]
```

Add a skill from various sources:
- **GitHub**: `capa add owner/repo@skill-name` (e.g. `capa add vercel-labs/agent-skills@web-researcher`)
- **GitLab**: `capa add gitlab:group/repo@skill-name`
- **Installed**: `capa add <skill-id> --installed [--requires "tool1,tool2"]` — skill already installed by user; capa only acknowledges for tool binding
- **Remote URL**: `capa add https://example.com/path/to/SKILL.md`
- **Local path**: `capa add ./path/to/skill` — directory must contain `SKILL.md`; stored as type `local` so the file is read on each install

**When to use**: Quickly adding community skills without manually editing the capabilities file.

---

## Clean Managed Files

```bash
capa clean
```

Removes all skill directories and MCP client configurations that were installed by CAPA. If the capabilities file has an `agents` section, also removes all capa-managed blocks from `AGENTS.md` and `CLAUDE.md` (each file is deleted if it becomes entirely empty after cleaning).

**When to use**: Cleaning up before reinstalling or removing CAPA-managed capabilities.

---

## Shell / Tool Executor

```bash
capa sh                                     # List all available commands
capa sh <group>                             # List subcommands for an MCP server group
capa sh <group> <subcommand> [--arg value]  # Run an MCP tool
capa sh <command> [--arg value]             # Run a top-level command tool
capa sh <unknown command>                   # Pass through to the OS shell
```

`capa sh` converts every configured tool into a CLI command. MCP server tools are grouped under the server ID (e.g. `gitlab`). Command tools appear at the top level, or under a custom `group` if defined. Tool IDs are automatically slugified to kebab-case.

`capa sh` is **non-interactive** — each invocation executes one command and exits, making it ideal for AI agents. Use `--help` at any level for contextual guidance:

```bash
capa sh --help                              # Top-level help
capa sh gitlab --help                       # List gitlab subcommands
capa sh gitlab list-merge-requests --help   # Show argument details
```

**Requires**: a `capabilities.yaml` in the current directory and the CAPA server running (`capa start`). Run `capa install` at least once to register the project.

---

## Server Management

```bash
capa start              # Start the CAPA server (background)
capa stop               # Stop the CAPA server
capa restart            # Restart the CAPA server
capa status             # Check server health and uptime
```

**When to use**: Managing the background MCP server that handles tool execution and credential management.
