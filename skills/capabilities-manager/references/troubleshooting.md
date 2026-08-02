# Troubleshooting

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
- **Resolution**: Remove the phrase from the skill's files, or remove/comment out `blockedPhrases` (or change the restriction) in your capabilities file, then run `capa install` again

### MCP Server: Self-Signed Certificate Error

If you see `SELF_SIGNED_CERT_IN_CHAIN` errors when connecting to an internal server:

- Add `tlsSkipVerify: true` to the server's `def` block in `capabilities.yaml`
- Run `capa install` then `capa restart`
- Only use this for trusted internal servers

### MCP Server: Token Auth Returns Errors During Startup

If a server that uses Bearer token auth (e.g. Databricks, a self-hosted GitLab MCP) reports connection errors at startup:

- Ensure the `Authorization` header is present in `def.headers` — CAPA skips the OAuth2 probe for these servers automatically
- Verify the token stored for `${VarName}` is valid for the specific server URL (wrong-workspace tokens are a common cause of 403 errors)
- Re-set the token by re-running `capa install -e` with an updated `.env` file, or update it via the web UI during `capa install`

### Tool Not Found Errors

- For MCP tools, skill `requires` must use `@server_id.tool_id` format (e.g., `@brave.search`)
- For command tools, skill `requires` uses the plain tool ID (e.g., `greet_user`)
- Check that server ID in tool definition uses `@` prefix (e.g., `@server-id`)
- Ensure MCP server is running: check `capa status`
- Verify tool name matches the actual tool provided by the MCP server

### Provider Not Found / Interactive Prompt Required

When `providers` is omitted from the capabilities file and no `--provider` flag is passed:

- **In a TTY**: capa shows an interactive prompt to select a provider
- **In CI/non-TTY**: fails with an error. Fix: pass `--provider <id>` explicitly

```bash
# CI-safe: always pass --provider
capa install -p cursor

# See all supported providers
capa install -p invalid-name  # error message lists all valid provider IDs
```

Once a provider is selected, it's stored in the DB and reused on subsequent installs.

### Stale Cache / Outdated Remote Sources

If skills, rules, or plugins from remote repositories aren't updating:

```bash
# Bypass cache for one install
capa install --no-cache

# Or wipe the full cache
capa cache clean
capa install
```

### Rules Not Appearing

- Verify the `rules` section is present in `capabilities.yaml`
- For Cursor: rules are written to `.cursor/rules/{id}.mdc` — check that directory
- For Claude Code/Codex: rules are folded into the instructions file (e.g. `CLAUDE.md`)
- If `providers` field is restricted on a rule, ensure your active provider matches
- Run `capa clean` then `capa install` to force a full reinstall

### MCP Server Not Registered (No Tools Configured)

If `capa install` does not register the MCP server in `.cursor/mcp.json` or equivalent:

- This is expected when no tools or subagents are configured in the capabilities file
- Add at least one tool or subagent to trigger MCP server registration
- If the server was previously registered but tools were removed, capa automatically unregisters it

### Cannot Run Command Inside Wrap Workspace

If you see `Cannot run "capa <command>" inside a wrap workspace`:

- You are inside `~/.capa/workspaces/...` (or a symlink into it)
- `cd` back to the real project path shown in the error (or check `.capa-workspace.json` / the wrap marker for `realProjectPath`)
- Run `capa install` / `capa add` / `capa clean` from the real project; then re-launch with `capa wrap <provider>` if needed

### Wrap Symlink Failures (Windows)

If `capa wrap` fails creating the shadow workspace on Windows:

- Enable [Developer Mode](https://learn.microsoft.com/windows/apps/get-started/enable-your-device-for-development) so symlinks work without elevation, **or** run an elevated shell
- Confirm the project path is not already a wrap workspace
- Try `capa wrap --prune` then retry

### Passthrough Wrote Files but `capa clean` Did Not Remove Them

- Expected — `--passthrough` writes unmanaged provider-native files
- Delete the files manually, or re-add them via managed `capa add` (without `--passthrough`) so future cleans track them

### Activity Feed Empty / Missing Events

- Confirm `options.agentActivity` is not set to `false`
- Re-run `capa install` so system activity hooks are injected
- Open the project page in the Web UI (`capa status` for the URL) — Activity lives there, not in the CLI
- Providers without hook support will not emit lifecycle events (tool calls via the MCP proxy still appear)

### `--tool` Refused With `--passthrough`

- Tool aliases, defaults, and formatters require the managed MCP proxy
- Drop `--passthrough` and use a normal `capa add --tool …` + `capa install`
