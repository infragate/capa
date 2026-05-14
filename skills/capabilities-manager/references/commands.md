# Command Reference

## Contents

- Initialize Capabilities · Install Capabilities · Add Skills · Clean Managed Files · Shell / Tool Executor · Server Management · Authentication · Upgrade · Cache Management · Registry Management

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
capa install -p cursor      # Install for a single provider
capa install --no-cache     # Bypass on-disk cache; re-resolve all remote sources
```

Reads the capabilities file and:
1. Resolves providers (from the file, `--provider` flag, DB memory, or interactive prompt)
2. Installs all skills to configured MCP clients (creates skill directories in `.cursor/skills/` and/or `~/Library/Application Support/Claude/skills/`)
3. Installs/updates `AGENTS.md` (always) and `CLAUDE.md` (when `claude-code` is in providers) if the `agents` section is present (downloads base file, upserts/prunes snippets)
4. Installs rules into each provider's rules directory or instructions file if the `rules` section is present
5. Resolves plugins and merges their skills, servers, and tools
6. Configures the CAPA server with your tools and servers
7. Prompts for any required credentials via web UI (unless `-e` flag is used)
8. Registers the project's MCP endpoint in client config files (skipped when no tools or subagents are configured)

**Security**: If `options.security` is configured with `blockedPhrases` or `allowedCharacters`, the corresponding checks run during installation. Omit or comment out each property to disable it. If a blocked phrase is found, installation stops immediately and reports which skill and phrase caused the block. When `allowedCharacters` is present, character sanitization runs: the baseline (printable ASCII + standard whitespace) is always preserved, and the value specifies extra Unicode ranges to keep on top of that.

**Flags**:
- `-e, --env [file]`: Load variables from a `.env` file instead of using the web UI
  - Without filename: Uses `.env` in the project directory
  - With filename: Uses the specified file (e.g., `.prod.env`, `.staging.env`)
  - The env file must exist, or the command will fail with an error
  - All required variables must be present in the env file
- `-p, --provider <id>`: Install for a single provider (e.g. `cursor`, `claude-code`). Overrides the `providers` field in the capabilities file.
- `--no-cache`: Bypass the on-disk cache and lockfile; re-resolve every remote source (skills, agents, rules, plugins) from scratch.

**Provider resolution** (when `providers` is omitted from the capabilities file):
1. `--provider` flag (highest priority)
2. `providers` array in the capabilities file
3. Stored providers from a previous install (persisted in DB)
4. Interactive prompt (TTY only — auto-detects installed providers)

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
- **GitHub (search)**: `capa add owner/repo@skill-name` — capa searches the repo for a directory named `skill-name`. Use when the name is unique.
- **GitHub (exact)**: `capa add owner/repo::skills/path/to/skill-name` — exact directory path inside the repo.
- **GitLab (search)**: `capa add gitlab:group/repo@skill-name` (subgroups supported)
- **GitLab (exact)**: `capa add gitlab:group/sub/repo::skills/path/skill-name`
- **Pinning** (works with both `@` and `::`): append `:v1.2.3` for a tag/branch or `#abc1234` for a commit SHA — e.g. `capa add owner/repo@skill:v1.2.3`, `capa add gitlab:group/repo::skills/x/y#abc1234`.
- **Registry**: `capa add <registryId>:<itemId>` — resolve the skill from a configured registry adapter. Example: `capa add skills-sh:vercel-labs/skills/find-skills`. The registry's `view()` method is called to fetch the install snippet, which is then added to `capabilities.yaml`.
- **Installed**: `capa add <skill-id> --installed [--requires "tool1,tool2"]` — skill already installed by user; capa only acknowledges for tool binding
- **Remote URL**: `capa add https://example.com/path/to/SKILL.md`
- **Local path**: `capa add ./path/to/skill` — directory must contain `SKILL.md`; stored as type `local` so the file is read on each install

**When to use**: Quickly adding community skills without manually editing the capabilities file. Prefer `@` for the common case (unique skill names); fall back to `::` to disambiguate or to keep the reference tied to a specific layout. Use the `<registryId>:<itemId>` syntax to install from a configured third-party registry.

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
capa start -f           # Start in foreground (for debugging)
capa stop               # Stop the CAPA server
capa restart            # Restart the CAPA server
capa status             # Check server health and uptime
```

**When to use**: Managing the background MCP server that handles tool execution and credential management.

---

## Authentication

```bash
capa auth               # Authenticate with the default Git provider
capa auth github.com    # Authenticate with GitHub
capa auth gitlab.com    # Authenticate with GitLab
```

Authenticates with Git providers for accessing private repositories (skills, plugins, agent snippets). Credentials are stored securely in the capa database.

**When to use**: When you need to access private GitHub or GitLab repositories for skills or plugins.

---

## Upgrade

```bash
capa upgrade
```

Upgrades capa to the latest published version.

**When to use**: When a new version of capa is available (capa will notify you after commands when an update is available).

---

## Cache Management

```bash
capa cache              # Show cache stats (location, size, per-repo breakdown)
capa cache clean        # Remove all cached repositories and snapshots
```

Capa caches remote sources (GitHub/GitLab repositories) locally to speed up subsequent installs. The cache stores bare git mirrors and file snapshots. Use `capa cache clean` to free disk space, or `capa install --no-cache` to bypass the cache for a single install without clearing it.

**When to use**: Inspecting cache disk usage or clearing stale cached data.

---

## Registry Management

```bash
capa registry              # List all configured registries (same as `capa registry list`)
capa registry list         # List all configured registries and their capabilities
capa registry path         # Print the registries directory path (~/.capa/registries/)
```

Registries allow browsing and installing skills and plugins from third-party sources (e.g. skills.sh, internal company registries, JFrog). Each registry is a TypeScript file in `~/.capa/registries/` that exports a `RegistryAdapter` with `search()` and `view()` methods.

### Setting up a registry

1. Run `capa registry path` to find the registries directory
2. Copy an adapter `.ts` file into that directory (see `examples/registries/` in the capa repo for reference adapters)
3. Run `capa registry list` to verify the adapter loaded correctly
4. Open the capa web UI — a "Registries" tab will appear in the navigation bar
5. Browse and install from the web UI, or use `capa add <registryId>:<itemId>` from the CLI

### Installing from a registry

```bash
capa add skills-sh:vercel-labs/skills/find-skills     # Install a skill from skills.sh
capa add acme-internal:design-system/checkout          # Install from an internal registry
```

The syntax is `<registryId>:<itemId>` where `registryId` matches the `manifest.id` of the adapter and `itemId` is the registry-specific identifier for the item.

### Security

Registry adapters are executable TypeScript files — only use adapters from sources you trust. Capa logs every loaded registry on startup. There is no auto-download of registry files from URLs.

**When to use**: When you want to browse, search, and install skills or plugins from public or private registries beyond GitHub/GitLab.
