---
name: capabilities-manager
description: Manages capabilities.yaml (or .json), CAPA CLI commands, skills, tools, MCP servers. Use when editing the capabilities file, installing or cleaning capabilities, or running tools via capa sh.
---

# Capabilities Manager

Manages agent capabilities with the CAPA CLI: define and install skills, configure MCP servers and tools, and control AGENTS.md/CLAUDE.md via the capabilities file.

**Detail** lives in `references/`: full command reference, schema, workflows, examples, and troubleshooting. Read the relevant file when you need step-by-step or YAML examples.

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
- User wants to run tools from the command line or explore available tools with `capa sh`

## Core Concepts

### Capabilities File

The `capabilities.yaml` (or `capabilities.json`) file defines everything an agent can do. It has six main sections:

1. **providers**: MCP clients where skills are installed (e.g. `cursor`, `claude-code`)
2. **options**: Tool exposure (`toolExposure`), security (`security`), CLI prerequisites (`requiresCommands`)
3. **skills**: Modular knowledge packages (when/how to use tools)
4. **servers**: MCP servers (local subprocess or remote HTTP)
5. **tools**: Executable capabilities (MCP or shell commands)
6. **agents**: (Optional) Manages `AGENTS.md` / `CLAUDE.md` content in the project root

### Skills vs Tools

- **Skills**: Knowledge and context (non-executable markdown). Teach when and how to use capabilities.
- **Tools**: Perform operations (API calls, commands, file ops).

### Tool Exposure

- **expose-all** (default): All tools from all skills are exposed when the MCP client connects.
- **on-demand**: Tools are exposed only after the agent calls `setup_tools(["skill-id"])`.

### Security Options (`options.security`)

- **blockedPhrases**: Block install if any skill file contains a forbidden phrase. Inline list or `{ file: "./path.txt" }`. Omit to disable.
- **allowedCharacters**: Extra regex character class beyond the always-preserved baseline (printable ASCII, tab, LF, CR). `""` = baseline only; `"[\\u00A0-\\uFFFF]"` = allow all Unicode. Omit to disable sanitization.

Only properties that are present are applied. If a blocked phrase is detected during `capa install`, installation stops and reports which skill and phrase caused the block.

## Commands (Summary)

| Command | Purpose |
|--------|--------|
| `capa init [--format json\|yaml]` | Create a new capabilities file |
| `capa install [-e [file]]` | Install skills, agents, register servers; prompt for credentials (use `-e` for .env) |
| `capa add <source> [--id <id>]` | Add a skill (GitHub, GitLab, remote URL, local path, or `--installed`) |
| `capa clean` | Remove CAPA-installed skills and agent blocks |
| `capa sh [group] [subcommand] [--arg value]` | List or run tools; unknown commands pass through to the OS shell |
| `capa start \| stop \| restart \| status` | Manage the CAPA server |

**Full command reference**: See `references/commands.md`.

## Capabilities File Structure (Summary)

- **Skills**: Six types — `inline`, `github`, `gitlab`, `remote`, `local`, `installed`. Each has `id`, `type`, `def` (and for inline, `content`; for others, `repo`/`url`/`path` plus optional `requires`, `description`).
- **Servers**: `type: mcp` with `def.cmd`/`args`/`env` (local) or `def.url`/`headers` (remote). Optional `tlsSkipVerify: true`, `description`.
- **Tools**: `type: mcp` (def: `server`, `tool`, optional `defaults`) or `type: command` (def: `run.cmd`/`args`, optional `init`, `group`, `description`).
- **Agents**: Optional `base` (ref or type+def) and `additional` list (inline, remote, github, gitlab snippets). Managed files: `AGENTS.md` always; `CLAUDE.md` when a Claude provider is present.

**Full schema and YAML examples**: See `references/capabilities-schema.md`.

## Workflows and Examples

Common flows: starting a new project (`capa init` → edit file → `capa install` → `capa status`), adding a community or local skill (`capa add` or edit YAML then install), creating an inline skill, using `capa sh` to run tools, and managing the server lifecycle.

**Step-by-step workflows and full YAML examples** (web research, file ops, mixed tools, on-demand loading, CLI prerequisites): See `references/workflows-and-examples.md`.

## Best Practices

1. **Organize by domain**: Group related skills and tools (e.g. web research + search tools).
2. **Use descriptive IDs**: Prefer kebab-case like `web-researcher`, `file-manager`.
3. **Document tool requirements**: Always set `requires` on skills.
4. **Secure credentials**: Use `${VarName}` placeholders; never commit secrets. CAPA prompts via web UI or `-e` .env.
5. **Test incrementally**: After changes, run `capa install`, then `capa restart`, and verify in the MCP client.
6. **Keep skills focused**: One clear purpose per skill.
7. **Prefer community skills**: Check skills.sh / vercel-labs/agent-skills before writing custom ones.

## Troubleshooting

If the server won’t start, skills don’t appear, credentials don’t prompt, an MCP server crashes, install is blocked by a forbidden phrase, you see TLS or token-auth errors, or tools are not found — use the diagnostic steps and resolutions in **`references/troubleshooting.md`**.

## Tools

This skill requires:

- `capa_init` — Initialize capabilities file
- `capa_install` — Install capabilities and skills
- `find_skills` — Search for skills in the ecosystem (e.g. via `npx skills find`)

## References

| Topic | File |
|-------|------|
| Commands (init, install, add, clean, sh, server) | `references/commands.md` |
| Capabilities schema (skills, servers, tools, security, agents) | `references/capabilities-schema.md` |
| Workflows and full examples | `references/workflows-and-examples.md` |
| Troubleshooting | `references/troubleshooting.md` |

## Additional Resources

- **CAPA GitHub**: https://github.com/infragate/capa
- **Skills.sh Ecosystem**: https://skills.sh
- **MCP Protocol**: https://modelcontextprotocol.io
- **Community Skills**: https://github.com/vercel-labs/agent-skills

## Notes

- CAPA is compatible with the skills.sh standard. Skills are installed as directories with SKILL.md.
- Server runs at `http://localhost:5912`. Credentials in `~/.capa/capa.db`. Logs in `~/.capa/logs/`.
- Tool naming: MCP tools are `server_id.tool_id`; in skills use `@server_id.tool_id`; command tools use plain ID. `capa sh` slugifies to kebab-case.
- OAuth2 probe is skipped for servers that already have an `Authorization` header. Use `tlsSkipVerify: true` for trusted self-signed servers. `capa sh` is non-interactive (one command per invocation).
