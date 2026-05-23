# MCPJam (`mcpjam`)

> **Status:** Not integrated — out of scope  
> **Skills dir:** `.mcpjam/skills/` (global: `~/.mcpjam/skills`)  
> **Docs root:** *(intentionally skipped)*

Source-of-truth definition: [`src/shared/providers/registry.ts → mcpjam`](../../src/shared/providers/registry.ts).

MCPJam is not an agent client — it's an **MCP testing harness**. It's
listed in the registry so its skills directory is recognised by tooling,
but capa intentionally does not write project-local config for it
because there is no agent-side runtime to configure.

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `.mcpjam/skills/<id>/` | Skills-only. |
| MCP | — | N/A — MCPJam tests MCP servers, it doesn't host an agent that consumes them. |
| Instructions | — | N/A. |
| Rules | — | N/A. |
| Sub-agents | — | N/A. |
| Plugin manifests | — | Not declared. |

Last verified: 2026-05-23
