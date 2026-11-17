# PR #383 review decisions

Behavior decisions are settled. This records the agreed design; implementation has not started. See [the implementation plan](implementation-plan.md).

Sources: [PR #383](https://github.com/infragate/capa/pull/383),
[issue #208](https://github.com/infragate/capa/issues/208).

## Agreed behavior

- Use `.config/capa/config.{toml,yaml,json}` for the nested configuration location, replacing `.config/capabilities/config.{toml,yaml,json}`.
- Write `capabilities.lock` in the winning configuration's format. In ordinary projects, keep it beside that configuration. Wrap uses the private-root exception below.
- Leave existing uploaded assets and their references untouched. New uploads use typed folders under `.config/capa/` when the winning configuration is under the project's `.config/`; root configurations retain `.capa/imports/`.
- Preserve project-root selection: CLI commands use the current directory; callers that supply a project path use that path. Do not add Git-root detection or upward configuration search.
- Discover configuration candidates only within that project root. Nested projects remain independent, consistent with the current behavior described in issue #208. A configuration under `.config/` does not change the project root or generated output location.
- Preserve local path bases: skills resolve from the project root; rules and agent instructions resolve from the configuration directory.
- Translate Browse selections to the same stored-path form as uploads. Filesystem navigation remains project-relative. For `.config/capa/config.yaml`, selecting `docs/team.md` as a rule or instruction stores `../../docs/team.md`.
- Preserve rules' existing ability to reference files outside the project, including relative and absolute paths. Do not expand Browse to external files: it stays inside the project, as on upstream `main` (`d7af119`).
- Show the project's root `.config` directory in Browse so users can navigate to `.config/capa/` assets. This is a narrow exception to the existing hidden-entry filter: other hidden entries, including `.git`, remain hidden. Keep Browse inside the project.
- Allow local agent base/snippet paths to contain `..` when the resolved file remains inside the project root. Reject paths that escape the project, including through symlinks. This replaces the briefly discussed external access for Browse and agent instructions; the user chose the smaller scope after comparison with upstream `main`.
- Keep remote repository path validation unchanged. Uploads and generated output retain their designated project destinations and existing write protections.
- Load only the active lock: beside the winning configuration for ordinary projects, or at the private working-directory root for wrap. Loading is read-only: do not copy, write, delete, or fall back to locks in other locations. An invalid unrelated lock cannot block loading the active lock.
- If the active lock is missing, install resolves versions afresh and writes a new lock at that active location in the config's format. Leave locks in other locations untouched, including during save. Users who want to preserve pins when moving an ordinary project's configuration must move its lock alongside it.
- Keep wrap's lock at the root of its private working directory, independent of the real project's lock, matching main's existing placement. This is an explicit exception to co-location for internal wrap workspaces, not a change to ordinary projects. Use the selected config's format. Route wrap lock reads, writes, cleanup, and relevant fingerprints to that same private location; never mutate the real lock through the linked `.config` directory. Keep source-directory linking rather than building a private nested config-directory chain solely for lock placement.
- Use shared lockfile parsing for wrap fingerprints across YAML, JSON, and TOML. Ignore `generatedAt` changes while retaining sensitivity to pinned-version changes. Preserve the existing treatment of other fingerprint fields unless separately agreed.
- Adopt the maintainer's lock comparison recommendation: sort object keys recursively and treat null-valued object fields as missing for comparison. Preserve array order and detect actual value changes. Replace the manually maintained field-order/null lists as far as possible; keep parsing and validation correct for TOML's omitted nullable fields rather than assuming comparison alone solves validation.
- If the TOML writer cannot represent a configuration value correctly, return a clear error identifying the unsupported value and leave the original configuration file unchanged. Do not silently omit meaningful nulls. Cover unsupported mixed-type arrays and meaningful nulls with regression tests, preserving existing optional-null semantics. Keep the existing TOML library for this PR.
- Use event-driven configuration discovery for watchers. Discover at startup and after relevant filesystem events, grouping rapid events into one check. Watch the project root and existing `.config/` and `.config/capa/` directories. Reconcile directory watches on structural changes even when the winning configuration is unchanged.
- Keep the 1.5-second poll limited to checking the active file's modification time. If that file disappears or a watcher errors, perform targeted rediscovery and repair watches. Do not add periodic full rediscovery or repeatedly search all candidates when no active file exists.
- Accept that a missed event for a new higher-priority configuration, while the current file remains unchanged, can leave selection stale until a later relevant event, explicit refresh, or server restart. A missed event for creation of the first configuration can likewise leave a project without an active configuration. Active-file modification-time polling cannot detect every change. See [watcher research](watcher-research.md).

## Approaches considered

- Project root: preserve current-directory/explicit-path behavior instead of Git-root selection or upward configuration search. This keeps nested projects independent and leaves hierarchical configuration to issue #208.
- Uploads: keep existing assets and references instead of automatically relocating them. This removes cached-UI overwrite races, partial migration failures, and shared-reference classification problems.
- Local sources: preserve rules' existing external-source behavior and keep Browse project-scoped. Expand agent references only enough to reach other files within the project from a nested configuration.
- Locks: match configuration format instead of always writing TOML. Load only the active lock and leave unrelated locks untouched instead of implicitly migrating old pins.
- TOML writes: fail clearly before changing a file when a meaningful value cannot be represented, rather than silently losing information or replacing the library in this PR.
- Watchers: use event-driven discovery and active-file polling instead of full discovery on each poll or an additional 30-second full-discovery timer. Accept the documented missed-event limitation.

## Proposed implementation order

1. Update the nested configuration location to `.config/capa/`, including discovery candidates, upload destinations, lock paths, and watcher directory names. Preserve discovery precedence: root, `.config/`, then `.config/capa/`, with TOML before YAML before JSON within each location.
2. Remove upload migration and retain the small helpers for upload-kind validation and stored-path conversion. Apply the same conversion to Browse selections without changing its project-relative navigation or external-access boundary. Expose the root `.config` directory through the agreed hidden-entry exception. Allow agent references to traverse from the configuration directory to other locations within the project; keep remote snapshot guards separate.
3. Restore format-matched lock writes and make lock loading read-only. Use the co-located active lock for ordinary projects and the explicit private working-directory root lock for wrap. Ensure a format switch rewrites the active lock in the requested format even when pins are unchanged. Leave unrelated locks untouched, and apply the same active-path policy to cleanup and fingerprints.
4. Share parsing and canonical semantic comparison between lock loading/saving and wrap fingerprints. Keep TOML nullable-field validation and in-memory entry types correct without maintaining field-order tables solely for comparison.
5. Add clear TOML representation errors before file writes. Preserve comments on successful edits and the original file on failed edits.
6. Fix watcher directory reconciliation and event filtering, then remove normal polling-time full discovery and duplicate discovery during reload. Retain debounce, self-write handling, cleanup, and targeted recovery.
7. Update README, detailed docs, skill reference documentation, locale hints, and eventually the PR description to describe the final behavior. Remove claims about always-TOML locks and automatic migrations.

## Builder details

These are implementation choices consistent with the agreed behavior, rather than additional user requirements:

- Keep content-based parsing for the active lock when its current format differs from the configuration. Preserve existing fingerprint fields, including `generator`.
- Apply TOML representation checks to both fresh writes and comment-preserving edits, using the existing distinction between absent optional fields and meaningful null defaults.
- Debounce discovery itself, retain events arriving during watcher reconciliation, and distinguish a missing file from permission or other stat failures. Updating directory watches must not depend solely on a winner change.

## Proposed verification

- Discovery: supported locations and formats, unchanged precedence, nested independent projects, and unchanged default init behavior.
- Browse/uploads: skills, rules, agent bases, and snippets for root and nested configurations; correct stored paths; no migration or rewrite of existing references; external Browse denied; valid project-local agent parent paths accepted; outside-project and symlink escapes rejected for agent sources; rule behavior unchanged.
- Locks: YAML/JSON compatibility, TOML round trips, co-location, no read-side writes/deletions, missing active lock with valid or malformed unrelated locks, and format switches with unchanged pins.
- Comparison/wrap: timestamp-only changes and object-key ordering leave identity stable; omitted null fields compare consistently; actual pin changes and meaningful array-order changes remain detectable across all formats.
- TOML mutations: unsupported meaningful nulls and mixed arrays leave the original file intact and produce actionable errors; supported edits retain comments.
- Watchers: config edits and format/location switches; new/replaced nested directories; unchanged winner with new directories; missing filenames; disappearance/error recovery; self-writes and cleanup; normal polling does not scan candidates.
- Run focused regression tests, relevant install/server/wrap integration tests, and the Web UI type check. Broaden checks only if changes or failures justify it.

## Status

All ten maintainer review threads and the two choices raised by the architecture audit now have agreed directions. No product code has been changed during this discussion. The local implementation plan records concrete changes and verification; execution remains a separate step.

## Follow-up architecture audit

The user requested research against upstream main and Bun before confirming the design. See [the architecture audit](architecture-audit.md), [path findings](paths-audit.md), and [serialization findings](serialization-audit.md).

The audit supports the agreed product directions, with implementation refinements: preserve wrap's private lock storage; distinguish trusted source roots from shadow output roots; canonicalize symlink-root paths consistently; include config location in wrap invalidation; validate actual TOML output with the production reader; strengthen active-lock format recognition; preserve typed nullable-field decoding; restrict empty-install cleanup to the active lock; and explicitly reload when the first config becomes selected. These are research findings to incorporate into the plan, not product changes already made.

The wrap storage choice is now settled: use an explicit private working-directory root lock, as on main. The alternative private nested directory chain is not selected. This decision supersedes the open storage question in the research snapshot.

The Browse visibility choice is also settled: expose the root `.config` directory only as a narrow exception to the hidden-entry filter. External browsing remains out of scope. There are no remaining behavior questions from the audit.

Local audit reproductions used Bun 1.4.4/Linux. Implementation verification must still use the CI baseline of Bun 1.3.14 on Linux, macOS, and Windows. Do not replace existing libraries with newer Bun-native serialization APIs without supported-version evidence.
