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

## Add Skills & Plugins

```bash
capa add [--plugin|--skill] <source>
capa add --plugin <source>
```

Add a skill (default) or plugin from various sources. Without a flag, `--skill` is assumed for backward compatibility.

### Skills

- **GitHub (search)**: `capa add owner/repo@skill-name` — capa searches the repo for a directory named `skill-name`. Use when the name is unique.
- **GitHub (exact)**: `capa add owner/repo::skills/path/to/skill-name` — exact directory path inside the repo.
- **GitLab (search)**: `capa add gitlab:group/repo@skill-name` (subgroups supported)
- **GitLab (exact)**: `capa add gitlab:group/sub/repo::skills/path/skill-name`
- **Pinning** (works with both `@` and `::`): append `:v1.2.3` for a tag/branch or `#abc1234` for a commit SHA — e.g. `capa add owner/repo@skill:v1.2.3`, `capa add gitlab:group/repo::skills/x/y#abc1234`.
- **Registry**: `capa add <registryId>:<itemId>` — resolve the skill from a configured registry adapter. Example: `capa add skills-sh:vercel-labs/skills/find-skills`.
- **Installed (no CLI)**: declare `type: installed` directly in `capabilities.yaml` — capa only records the skill for tool binding, it does not fetch or install anything. Set `def.description` and `def.requires` on the entry. Same pattern for `type: plugin` (skills shipped by a configured plugin).
- **Remote URL**: `capa add https://example.com/path/to/SKILL.md`
- **Local path**: `capa add ./path/to/skill` — directory must contain `SKILL.md`; stored as type `local` so the file is read on each install

### Plugins

Use `--plugin` to add a plugin entry (MCP server bundles, skills, hooks, etc.) instead of a skill:

- **GitHub root**: `capa add --plugin slackapi/slack-mcp-plugin`
- **GitHub subpath**: `capa add --plugin anthropics/claude-plugins-official::plugins/frontend-design`
- **GitLab (nested groups)**: `capa add --plugin gitlab:acme/platform/team/services/devops-skills:v1.0.1`
- **URL**: `capa add --plugin https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review`
- **Registry**: `capa add claude-plugins:frontend-design` — the registry adapter determines whether the item is a skill or plugin.

The `--plugin` and `--skill` flags are mutually exclusive. When a source matches a registry (`<registryId>:<itemId>`), the registry adapter's resolved capability takes precedence; a conflicting flag emits a warning but install proceeds.

**When to use**: Quickly adding community skills or plugins without manually editing the capabilities file. Use `<registryId>:<itemId>` to install from a configured third-party registry.

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
capa registry                                              # List all configured registries (same as `capa registry list`)
capa registry list                                         # List all configured registries with status, type, source
capa registry path                                         # Print the managed registries directory (~/.capa/registries-managed/)

capa registry add <source> [slug]                          # Fetch + install a registry adapter
capa registry add infragate/capa@skills-sh                 # GitHub source, search-form (auto type=github)
capa registry add gitlab/group/proj::registries/internal --type=gitlab
capa registry add https://example.com/adapter.ts          # HTTPS URL source (type auto-detected from scheme)
capa registry add owner/repo@my-reg my-reg                 # Explicit slug when the auto-derived one collides or you want a friendlier name

capa registry remove <slug>                                # Delete the registry row and its materialized adapter file
capa registry refresh <slug>                               # Re-fetch the adapter from the stored source (updates resolved_ref)
capa registry enable <slug>                                # Re-enable a previously-disabled registry
capa registry disable <slug>                               # Hide a registry without removing it
```

Registries let you browse and install skills and plugins from third-party sources (e.g. skills.sh, internal company registries, JFrog). Each registry is tracked in capa's database; the adapter file is materialized into `~/.capa/registries-managed/<slug>/adapter.{ts,js,mjs}` after capa fetches and validates it.

### Setting up a registry

1. Run `capa registry add <source>` with one of:
   - `owner/repo@<name>` — GitHub search-form (capa searches the repo for a folder named `<name>` containing `adapter.{ts,js,mjs}`)
   - `owner/repo::path/to/<name>` — GitHub exact-path form
   - The same forms prefixed with `--type=gitlab` (or autodetected from `gitlab.com/...` style sources)
   - `https://...` — direct HTTPS URL to an adapter file (non-HTTPS URLs are rejected for security)
2. Capa derives a slug from the source (`infragate/capa@skills-sh` → `skills-sh`); pass an explicit slug as the second argument to override.
3. Run `capa registry list` to verify the registry shows `[ok]`.
4. Open the capa web UI — the **Registries** nav link is always visible; choose a registry, then browse and install from there, or use `capa add <slug>:<itemId>` from the CLI.

Registry management is also available from the web UI: navigate to **Registries → Manage registries** (or hit `/ui/registries/settings` directly) to add, refresh, enable/disable, or remove registries with a preview of the adapter source before installing.

### Installing from a registry

```bash
capa add skills-sh:vercel-labs/skills/find-skills     # Install a skill from skills.sh
capa add acme-internal:design-system/checkout          # Install from an internal registry
```

The syntax is `<slug>:<itemId>` where `slug` is the registry's slug from `capa registry list` and `itemId` is the registry-specific identifier for the item.

### Security

Registry adapters are executable TypeScript — only add sources you trust. Capa enforces HTTPS for URL sources (except `localhost` for testing) and validates the adapter shape before persisting the row; the UI also offers a "Preview" button that shows the raw adapter source before you confirm. There is no sandbox: the adapter runs in the same process as the capa server.

**When to use**: When you want to browse, search, and install skills or plugins from public or private registries beyond GitHub/GitLab.
