# PR #383 review implementation plan

Plan only. Product implementation has not started.

## Objective and references

Finish PR #383's project-local config discovery and TOML support while addressing all ten maintainer review threads. Preserve the project model and compatibility of upstream main wherever the requested feature does not require a change.

- [Agreed design](decisions.md)
- [Architecture audit](architecture-audit.md)
- [Paths and wrap evidence](paths-audit.md)
- [Serialization evidence](serialization-audit.md)
- [Watcher evidence](watcher-research.md)
- [Future work: on-demand watcher lifecycle](future-work-on-demand-watchers.md), outside this PR.
- Reference main: `d7af1197d4214599b8143794212b6094c9096d99`.
- Current PR head at planning time: `1d35b3b2db998442a1c23e5c88c0b1de12bc0b12`.

The supported verification baseline is the repository's Bun 1.3.14 CI matrix on Linux, macOS, and Windows. Audit reproductions used Bun 1.4.4/Linux and do not establish results for that matrix. Keep the current runtime and TOML dependencies.

## Invariants

- The CLI's current directory or an explicitly supplied project path defines the project root. No Git-root detection, upward search, config inheritance, or monorepo composition is added.
- Discovery precedence remains root, `.config/`, then `.config/capa/`, with TOML, YAML, JSON within each location. Root and flat `.config/capabilities.*` filenames stay unchanged. The nested form is `.config/capa/config.*`. Preserve the PR's existing conflict-warning behavior and default root YAML init.
- Skills remain project-relative. Rules and agent instructions remain config-directory-relative. Browse navigation remains project-relative, with conversion only for a selected path.
- Existing upload files and references do not move or get rewritten. New uploads use typed directories when the config is under `.config`; root configs retain `.capa/imports/`.
- Rules keep their existing external-source support. Browse stays within the project, with only the root `.config` directory newly visible among hidden entries. Agent sources can use parent segments within the trusted source project, but cannot escape it through symlinks or otherwise. Keep absolute/drive-prefixed agent paths rejected and remote-repository path restrictions unchanged.
- Ordinary locks live beside the selected config. Wrap's lock stays at the root of its private working directory. Both use the selected config's format. Every operation on a wrap lock must use that same private location.
- Loading a lock is read-only and does not use orphan locks. Missing active locks trigger fresh resolution. Unrelated lockfiles remain untouched, including on empty-install cleanup.
- Meaningful TOML values must survive serialization, or the operation fails before changing the file. Keep comment-preserving supported edits.
- Normal watcher polling checks only the active file. Discovery is event-driven, with exceptional recovery and the accepted missed-event limitation.

## Implementation choices

These are proposed implementation details that satisfy the agreed behavior. Exact internal names can follow the existing code style.

1. Reuse one detected config candidate within each upload, listing, install, or sync operation rather than deriving destination, stored path, and format from different discoveries.
2. Use a small internal lock-location context containing the effective path and output format. Ordinary callers retain their existing default behavior. Known wrap callers supply the private root location explicitly. Do not infer wrap mode from arbitrary path names or add public CLI flags. Carry the effective context through load, save, cleanup, and installed-state fingerprinting.
3. Let the listing response optionally carry a stored selection path in addition to each entry's navigation path when a validated content kind is requested. This reuses the listing endpoint and server-side path conversion rather than adding browser path arithmetic. Keep older listing callers compatible. A different equally small interface is acceptable if it preserves the same distinction.
4. Carry the trusted source-project root separately from the generated-output root into agent reads. Normal installs use one root for both; wrap passes its real source project explicitly through CLI install and server artifact sync.
5. Keep lock normalization, schema validation, serialization, and canonical identity in the lockfile module. Keep meaningful configuration values separate from lock metadata normalization.

## Work sequence

Use focused regression tests before each behavior fix. Each batch must leave its relevant tests and type checks passing. The suggested commit boundaries are review units, not instructions to publish or push during planning.

### 1. Rename the nested config location and remove upload migration

Primary files: `src/shared/paths.ts`, `src/shared/project-uploads.ts`, `src/server/project-fs.ts`, `src/server/capabilities-watcher.ts`; relevant path/upload tests.

- Replace `.config/capabilities/config.*` with `.config/capa/config.*` in candidate discovery and the watcher directory/filter definitions.
- Use `.config/capa/{skills,rules,instructions}` for new uploads when a config under `.config` wins.
- Remove the call to `ensureProjectUploadsMigrated` and its classification, movement, config-rewrite, collision, and empty-directory cleanup machinery. Retain or relocate only the useful kind validation and stored-path conversion helpers.
- Use consistent canonical bases when converting an actual upload destination to a stored path, including symlinked project roots.
- Do not add legacy-directory discovery or migration for an unreleased nested naming convention.

Verify: all nine candidates and precedence; default init; root upload behavior; both supported `.config` layouts and all content kinds; symlink-root upload paths; existing assets/config bytes remain unchanged by a new upload. Replace obsolete migration tests with preservation tests.

### 2. Make Browse selections usable without changing navigation scope

Primary files: `src/server/project-fs.ts`, `src/server/project-routes.ts`, `web-ui/src/features/projects/api.ts`, `web-ui/src/types/api.ts`, `web-ui/src/features/projects/components/LocalPathPicker.tsx`.

- Accept an optional validated content kind for path selection metadata. Detect the config once and apply the same conversion used by upload responses.
- Preserve entry navigation paths for listing, entering directories, moving to the parent, and list keys. File selection, directory selection, and keyboard selection use the translated stored path.
- Do not translate manual input, existing authored values, upload responses, or later save requests a second time.
- Show `.config` when listing the project root. Keep other dot-prefixed entries hidden and keep existing project-containment protections.
- Preserve the skills/rules/agent call sites' existing upload-kind declarations.

Verify: selecting and uploading the same file produces paths with the same resolution base; all selection handlers; `.config/capa` is navigable; `.git` stays hidden; external navigation/selection stays rejected; callers without a kind retain navigation-only behavior. Run the Web UI type check.

### 3. Resolve agent sources within the correct source project

Primary files: `src/cli/utils/agents-file/install.ts`, its read context/types, `src/cli/commands/install.ts`, `src/cli/commands/install-tasks/context.ts`, `src/cli/commands/install-tasks/install-agent-instructions.ts`, `src/server/sync-project-artifacts.ts`; a small shared local-source helper if needed.

- Resolve relative agent paths from the selected config directory while permitting `..`.
- Reject absolute/drive-prefixed paths before normalization. Check both logical containment and the existing file's realpath against the canonical trusted source root; handle different Windows drives correctly.
- Pass the real source-project root through both CLI wrap install and server shadow-sync paths. Do not use the shadow output root as the source trust root.
- Keep generated-output ownership and source/output self-reference checks tied to the output tree.
- Leave local rule loading, skill path bases, and remote-repository traversal policy unchanged.

Verify: root configs; both nested config layouts; local base and snippets; valid `../../docs/team.md`; external traversal, symlink escapes, absolute paths, and cross-drive cases; normal and shadow installs; server shadow sync; source/output self-reference and user-owned output protections.

### 4. Restore lock ownership and format compatibility, including wrap

Primary files: `src/shared/lockfile.ts`, `src/types/lockfile.ts`, `src/cli/commands/install.ts`, `src/cli/commands/install-tasks/context.ts`, `src/cli/commands/install-tasks/write-lockfile.ts`, `src/shared/install-fingerprint.ts`, `src/server/sync-project-artifacts.ts`, and the wrap install/sync callers that supply the effective location.

- Resolve the ordinary lock beside the selected config. Wrap explicitly uses `<private-working-directory>/capabilities.lock`; do not use the linked `.config` tree for lock storage.
- Use the config's selected format for writes, including shadow sync where the config path can belong to the real project.
- Remove migration and fallback reads. Read only the effective active path. Keep parse/schema failures of that file visible and unrelated files irrelevant.
- Parse existing active content independently of the newly selected config format. Replace fragile marker matching with parser-backed recognition plus lock-schema validation, or validated fallback. Distinguish parse recognition from the existing invalid-entry warning/skip policy.
- Save when either semantic values or output format differ. Preserve timestamps/generator on format-only conversion. No-op saves in the correct format still avoid rewriting.
- Delete only the effective active lock when the install or server sync produces no owned lock entries. Do not delete other candidates.
- Ensure normal clean, status, effective-capability resolution, installed-state recording, and server sync retain the correct ordinary/private behavior. Check every existing `getLockfilePath`, `loadLockfile`, and `saveLockfile` call site rather than patching only the CLI write task.
- Preserve root-private wrap lock placement for existing warm workspaces. If an unsafe root lock link is encountered, detach the link rather than touching its real target; do not migrate or delete a linked real nested lock.

Verify: YAML/JSON baseline compatibility; TOML round trips; missing/empty active lock; malformed active vs malformed unrelated lock; reordered/commented TOML and YAML containing TOML marker text; config format switches with unchanged pins; all read paths leave disk untouched; ordinary and wrap empty cleanup; wrap save/install/sync leave real lock bytes unchanged; existing warm-workspace reuse/repair.

### 5. Unify lock identity and invalidate wrap on config-location changes

Primary files: `src/shared/lockfile.ts`, `src/shared/install-fingerprint.ts`, `src/cli/utils/wrap/workspace.ts`; lockfile and wrap tests.

- Sort object keys recursively for lock comparison and omit null-valued object fields from that comparison. Preserve array order and array elements.
- Remove equality-only field-order tables. Retain schema-aware decoding of omitted nullable lock fields into the existing in-memory types. Keep required pins required, wrong types invalid, and main's warning/skip policy for invalid entries.
- Share parsing/semantic identity with wrap instead of using its separate JSON/YAML-only reader. Keep the existing semantic fields, including `generator` and provider ownership records; exclude only the already-excluded `generatedAt`.
- Include the winning config's project-relative location in wrap's configuration fingerprint. The real project's active lock remains an input to deciding whether wrap must reinstall; lock reads/writes for the shadow's own install record use the private lock context. Keep these two purposes distinct.
- Do not introduce recursive hashing of source files. Existing stored fingerprints may cause one reinstall after the comparison/location algorithm changes; do not delete caches to hide that transition.

Verify: stable identity for object-key order, omitted nullable metadata, timestamps, and equivalent supported formats; changed pins/generator/provider records and ordered values remain detectable; malformed-entry handling stays compatible; a config moved with identical text triggers wrap reinstall; generatedAt-only changes do not; real-project and shadow-install fingerprints read the intended locks.

### 6. Reject lossy or unreadable TOML output before writing

Primary files: `src/shared/capabilities.ts` and capability mutation tests. Keep `@iarna/toml` and `@decimalturn/toml-patch`.

- Prepare absent optional values using capa's existing optional-null semantics. Preserve arbitrary `default`/`defaults` content and array positions while checking representation.
- Reject meaningful nulls that TOML cannot represent, with a useful value path. Do not silently drop keys or remove null array elements.
- Generate fresh or comment-preserving output, then parse that exact string with the production reader and check that intended normalized values survived.
- Do not classify every mixed JavaScript array as unsupported: numeric coercion and nested arrays can have supported representations. Describe a reader/writer compatibility failure accurately when modern TOML itself permits the value.
- Complete representation checks before `Bun.write`. The guarantee concerns serialization/representation failure; do not claim crash-safe atomic disk replacement without implementing and verifying it.

Verify: meaningful nulls at tool defaults and in arrays; optional-null edits; `[1, 2.5]` through fresh and patched writes; unsupported string/number mixtures; supported nested arrays; errors identify a useful path and leave original bytes unchanged; supported edits preserve comments across mutation entry points.

### 7. Make watcher discovery event-driven and preserve reload correctness

Primary files: `src/server/capabilities-watcher.ts`; add a focused watcher test suite.

- Watch the project root plus existing `.config` and `.config/capa` directories with Bun-supported shallow watchers. Use the same config candidates as discovery.
- Handle relevant config filenames, structural directory creation/replacement/deletion, missing filenames, and watcher errors. Reconcile directory handles even when the selected file does not change.
- Debounce discovery itself. Preserve events arriving during reconciliation, prevent overlapping reloads, and retain teardown/self-write behavior.
- Make first selection and winner changes explicit reload reasons; modification-time equality must not suppress them.
- During normal 1.5-second polling, inspect only the active pathname. Rediscover exceptionally when it disappears or a watch fails. Distinguish missing-file errors from other read failures.
- Do not run full discovery repeatedly when no active config exists. Keep parent-directory watches active for creation events. No additional 30-second search timer.
- Preserve the accepted limitation: a missed creation event can leave a new or higher-priority config undiscovered until another event, explicit refresh, or restart.

Verify: first config creation, edits, format/location switches, new/replaced directories with unchanged winner, missing filenames, queued events, self-writes, disappearance/error recovery, stop/unwatch cleanup, one active poll per project, and no full candidate scan during ordinary polling. Use deterministic state/lifecycle tests plus small real-Bun filesystem cases rather than relying only on arbitrary sleep durations.

### 8. Update documentation, validate the complete change, and prepare review

Primary files: `README.md`, `docs/README.md`, relevant capability-manager/bootstrap skill references, `web-ui/src/locales/en/projects.json`, and the local design/research documents.

- Document supported config locations/precedence, ordinary lock co-location and wrap's private-root exception, format matching, and read-only active-lock loading.
- Explain that moving a config requires moving its lock to preserve pins and rebasing config-relative rule/instruction paths. Skills retain project-relative paths. No automatic migration or orphan-lock fallback.
- Document typed upload folders, Browse's `.config` exception, agent source scope, and the accepted watcher limitation.
- Remove stale claims about `.config/capabilities/config.*`, always-TOML locks, or upload/lock migrations. Keep historical audit references clearly marked as observations of pre-fix code.
- Run the relevant focused suites and both TypeScript checks, then the full Bun test suite once the combined implementation is stable. Use the existing CI matrix to verify Bun 1.3.14 across platforms; report any environment that could not be executed.
- Review the final diff against the agreed design and the maintainer threads. Once implementation and review are complete, draft the updated PR description around the actual final behavior and validation. Planning does not publish comments, resolve review threads, push, or merge.

## Dependencies and review units

Suggested order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Serialization and watcher work are mostly independent, but keep one integration branch and avoid parallel edits to shared path/lock modules without clear ownership.

The most important integration checks are:

1. Browse → saved rule/agent config → successful install, for both nested layouts.
2. Real project → wrap install/sync/cleanup → unchanged real lock and correct private lock.
3. Config format/location switch → retained active pins where the path is unchanged, correct rewrite format, and correct wrap reinstall.
4. Failed TOML mutation → useful error, unchanged file, and successful subsequent load of the original.
5. Directory/config events → correct selected config and reload, without idle nine-candidate scans.

## Completion criteria

- All ten maintainer concerns and the audit's wrap/Browse findings have regression coverage and a concrete implementation or an explicitly documented accepted limitation.
- Root project behavior and existing YAML/JSON projects remain compatible with main, except for intentional PR discovery behavior and the agreed narrow Browse/agent extensions.
- No upload migration, read-side lock mutation, unrelated-lock deletion, or shadow-to-real lock writes remain.
- Tests and type checks pass on the environments actually run; remaining CI/runtime verification is stated accurately.
- The final change is organized into reviewable commits and its PR description describes the resulting behavior without obsolete migration promises.
