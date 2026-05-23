# OpenClaw (`openclaw`)

> **Status:** Not integrated  
> **Skills dir:** `skills/` (global: `~/.openclaw/skills`, `~/.clawdbot/skills`, or `~/.moltbot/skills` depending on which OpenClaw variant is installed)  
> **Docs root:** *(home-workspace based, no central docs)*

Source-of-truth definition: [`src/shared/providers/registry.ts → openclaw`](../../src/shared/providers/registry.ts).

OpenClaw is **home-workspace-based**, not repo-based — its `AGENTS.md` /
`SOUL.md` and configuration live in `~/.openclaw/workspace` by default,
not in the user's project. That breaks the assumptions capa makes about
project-local writes, so the provider is skills-only.

## Capa integration

| Feature | Path | Notes |
| --- | --- | --- |
| Skills | `skills/` | Project-relative if the user opts into a workspace-rooted layout; otherwise lives in the home workspace. |
| MCP | — | Home-workspace based. |
| Instructions | — | Home-workspace based (`SOUL.md` / `AGENTS.md` in `~/.openclaw/workspace`). |
| Rules | — | Not wired up. |
| Sub-agents | — | Not wired up. |
| Plugin manifests | — | Not declared. |

## Blocking work

- Capa would need a "home-workspace aware" provider mode before it can
  meaningfully write to OpenClaw. Until then, document only.

Last verified: 2026-05-23
