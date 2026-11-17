# Future work: watch projects while they are in use

Status: future proposal. This work is outside PR #383 and is not approved for implementation.

## Problem

The server starts a configuration watcher for every registered project. Each watcher holds filesystem handles and runs a regular check, even if nobody uses the project.

Watching only projects open in the dashboard can reduce this work, but dashboard state is not sufficient. Configuration reloads also update runtime capabilities and generated hooks, rules, instructions, and wrap files. An agent can need these updates while the dashboard is closed.

The current code starts watches at [server startup](../../src/server/index.ts), reloads through [project routes](../../src/server/project-routes.ts), and applies changes through [configuration routes](../../src/server/configure-routes.ts). Wrap also has a [separate CLI watcher](../../src/cli/utils/wrap/watch-project.ts).

## Proposed behavior

Watch a project while at least one consumer needs live updates:

- A dashboard page subscribes to the project's events.
- An agent or Model Context Protocol (MCP) session actively uses the project.
- A running wrap session uses the project.

When all consumers become inactive, keep the watcher for a short idle period. Then stop its filesystem watches and polling timer. The idle period remains to be chosen.

Before an inactive project becomes active again, reload its configuration from disk and establish its watches. This must catch changes made while the watcher was stopped.

## Ownership and lifecycle

Keep watcher ownership on the server. Track consumers per project instead of letting a browser tab directly start or stop the shared watcher.

- Multiple tabs or sessions share one server watcher for a project.
- Closing one consumer does not stop updates for other consumers.
- Reconnects and repeated subscriptions do not leak consumer counts, handles, or timers.
- New activity cancels a pending idle shutdown.
- Project removal and server shutdown release all resources.

Coordinate this lifecycle with the existing wrap watcher. Do not remove a watcher merely because another process might be watching the same files. Establish which updates each watcher owns first.

## Behavior change

An inactive project's generated files and cached capabilities will not update immediately after an external edit. Updates resume when the project becomes active again.

This is a change from watching every registered project. Confirm that delayed updates for inactive projects are acceptable before implementation.

## Decisions still needed

- Define an active runtime session. An open network connection alone is not enough because MCP clients can use short requests or disconnect temporarily.
- Choose the idle period and the rules for expiring abandoned sessions.
- Define when a returning consumer can use the project: after configuration refresh completes, or with a clearly specified transitional state.
- Decide what happens when configuration refresh fails. Do not silently serve stale capabilities as if refresh succeeded.
- Identify background work that needs live updates without an open dashboard or agent connection.
- Define ownership between server watches and CLI wrap watches, including process exit and reconnect behavior.

## Verification and value

Measure watcher handles, polling work, and refresh time with many registered but inactive projects. Use those results to judge whether the lifecycle complexity is worthwhile.

Verify multiple tabs, concurrent runtime sessions, reconnects, idle shutdown, reactivation after disk edits, failed refreshes, wrap-only use, project removal, and server shutdown.

Use Bun's supported filesystem interfaces and the project's supported Bun version and operating-system matrix. Do not infer Bun behavior solely from Node documentation.

## Relationship to PR #383

Keep the [agreed event-driven discovery and active-file polling changes](decisions.md) in PR #383. This proposal changes when watchers run and belongs in a separate follow-up. It does not change the current [implementation plan](implementation-plan.md).
