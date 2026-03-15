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
- Re-set the token with `capa vars set VarName <new-token>` or re-run `capa install -e` with an updated `.env` file

### Tool Not Found Errors

- For MCP tools, skill `requires` must use `@server_id.tool_id` format (e.g., `@brave.search`)
- For command tools, skill `requires` uses the plain tool ID (e.g., `greet_user`)
- Check that server ID in tool definition uses `@` prefix (e.g., `@server-id`)
- Ensure MCP server is running: check `capa status`
- Verify tool name matches the actual tool provided by the MCP server
