# PR #383 architecture audit

Research date: 2026-11-17. Research only; no implementation changes.

## Reference and limits

The compatibility reference is upstream `main` at `d7af1197d4214599b8143794212b6094c9096d99`, refreshed during this audit. The PR branch is at `1d35b3b2db998442a1c23e5c88c0b1de12bc0b12`. The design under review is [the decision document](decisions.md).

This is a Bun project. Local reproductions run on Bun 1.4.4/Linux; CI pins Bun 1.3.14 on Linux, macOS, and Windows. The audit does not substitute for that CI matrix. Bun officially supports `node:fs` and recommends it for directory operations. Keeping those imports is consistent with Bun; replacing them for their names alone would add churn. [CI](../../.github/workflows/test.yml), [Bun compatibility](https://bun.sh/docs/runtime/nodejs-compat), [Bun file I/O](https://bun.sh/docs/runtime/file-io#directories).

There is no universally best design independent of requirements. The assessment below favors compatibility with main, the maintainer's review, predictable file ownership, and the smallest change that delivers the requested locations and formats. Verdicts are engineering judgments based on the cited evidence.

## Decision assessment

| Decision | Assessment | Basis and remaining condition |
| --- | --- | --- |
| Keep current directory or explicit project path as root | Keep | Main already installs from that path. Git-root selection would change nested-project behavior. Issue #208 leaves hierarchy and inheritance as separate work. |
| Use `.config/capa/config.*` | Keep | A reasonable tool-specific namespace and the maintainer's explicit preference. Mise documents `.config/mise/config.toml`; that supports the convention, not a requirement to copy mise's discovery or path semantics. |
| Preserve path bases; translate Browse selections | Keep | Main resolves skills from the project root and rules/instructions from the configuration directory. A shared translation can correct Browse without changing those contracts. |
| Browse remains project-scoped; instructions can reach other project files | Keep, with wrap coverage | This avoids expanding the UI into a general filesystem browser. Instructions need config-relative `..` support while staying inside the intended source project. Wrap's source/output distinction needs explicit testing. |
| Preserve rules' existing external-source support | Keep for compatibility | Main's rule loader accepts relative and absolute local paths. Restricting it would be a separate behavior change, not required by this PR. |
| No upload migration; typed destinations for new uploads | Keep | Uploads no longer need to coordinate unrelated file moves, configuration rewrites, and cached UI state. Moving a config itself still requires adjusting relative rule/instruction references. |
| Match the lock format to the winning config | Keep | Main already matches root YAML/JSON configs. TOML becomes an addition rather than a forced format change for existing projects. Format switches must not lose current pins or be skipped as semantic no-ops. |
| Read only the active lock; leave other locks untouched | Keep | Main loading is read-only. Explicit co-location avoids reviving stale pins and makes status/fingerprinting safe from read-side file mutations. Moving a config and preserving its pins requires moving its lock too. |
| Shared lock parsing and semantic comparison | Keep with domain-specific normalization | One definition of lock identity avoids divergent no-op detection and wrap behavior. Do not apply null-as-missing to meaningful user configuration values or silently accept invalid lock fields. |
| Unsupported TOML values fail before writing | Keep | Representation errors must not alter the original file. Language capabilities and installed-library limitations must be distinguished; retain existing comment-preserving edits and optional-null semantics. |
| Event discovery plus active-file polling | Keep with the accepted limitation | Fits main's watcher model and reduces idle candidate scans. It cannot guarantee detection of a missed new-candidate event while the selected file stays unchanged. |

## Main-branch evidence

- Root selection and config detection: [main install command](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/cli/commands/install.ts), [main paths](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/shared/paths.ts), [maintainer's nested-project explanation](https://github.com/infragate/capa/issues/208#issuecomment-5458502715).
- Local sources: [main skill installer](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/cli/commands/install-tasks/helpers/install-one-skill.ts), [main rule loader](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/cli/commands/install-tasks/install-rules.ts), [main instruction loader](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/cli/utils/agents-file/install.ts), [main Browse/uploads](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/server/project-fs.ts).
- Locks and watcher lifecycle: [main lockfile module](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/shared/lockfile.ts), [main watcher](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/server/capabilities-watcher.ts).
- Naming comparison: [mise's documented configuration locations](https://mise.jdx.dev/configuration.html#config-file-locations). Capa need not adopt mise's inheritance or path bases to use the same directory naming pattern.

## Watcher implementation refinements

The following findings refine the implementation without changing the accepted event-driven design. See [the watcher research](watcher-research.md).

1. Reconcile watches independently of the selected config. Local Bun reproduction: root config gives one watch; creating `.config` and calling `watchProject` again leaves one watch when root plus `.config` require two.
2. Recognize structural folder events. Watching the project root does not replace watching nested `.config/capa` files. The current `.config` filter considers candidate filenames but omits its nested config-directory name.
3. Treat first selection and winner changes as explicit reload reasons. Local Bun reproduction: create the first config in a watched empty project; it becomes selected, but the reload callback count stays zero after 950 ms. Comparing only modification times suppresses that reload.
4. Debounce discovery itself and retain events received during an in-progress discovery. Otherwise an early-return flag can discard relevant work.
5. Keep normal polling to the selected pathname. Missing-file and watcher-error recovery are exceptional rediscovery triggers. Preserve self-write handling, cleanup, and one active poll per project.

Bun documents shallow watching by default and opt-in recursive watching. Up to three targeted shallow watches avoid observing unrelated repository trees. [Bun watcher guide](https://bun.sh/guides/read-file/watch).

The missed-event limitation is an algorithmic consequence: sampling only file A cannot reveal new file B if no event or explicit refresh reports B. This does not require assuming Node's backend behavior is identical to Bun's. Node documentation remains a portability reference in the earlier research, not proof of Bun-specific event delivery guarantees.

## Findings that must shape the implementation plan

Detailed evidence is in the [path/upload audit](paths-audit.md) and [serialization audit](serialization-audit.md). The research did not overturn the agreed product behavior, but the implementation is not safe to plan as only a rename and deletion of migration code.

### 1. Preserve wrap isolation for the new nested locks

Main excludes the root `capabilities.lock` from its linked shadow workspace. The new nested location bypasses that protection because `.config` itself is linked to the real project. A local Bun reproduction using `buildSymlinkWorkspace` and `getLockfilePath` confirmed that writing the shadow's selected nested lock changes the real lock. Renaming its directory to `capa` does not fix this.

Required outcome: normal projects retain co-located locks, and wrap installs/saves/empty-lock cleanup modify only a private shadow lock. Include repair of already-created warm shadows. A private directory chain around the nested lock is one solution; an explicit internal shadow-lock location is another. Choose the smallest solution that preserves existing wrap isolation and does not hide configuration/assets by excluding all of `.config`. This internal storage choice is not settled by the earlier co-location decision.

### 2. Separate the source project from the output project during wrap

Wrap reads real-project files through links but writes generated files into a shadow. Checking source realpaths against the shadow root rejects valid sources. Carry an explicit trusted source root through the CLI install and server sync paths, while keeping output ownership checks against the shadow root. Normal installs use the same root for both. Do not derive trust from an arbitrary symlink's target or weaken the shared remote-repository path guard.

### 3. Make path conversion consistent and location-sensitive

Canonicalize both sides of relative-path calculations when the project root is a symlink. The current helper mixes physical upload destinations with logical roots and can save a path containing an external checkout directory name. Use one winning config selection per operation and convert Browse selections exactly once; navigation, already-translated upload responses, and manual authored text are different inputs.

Include the selected config's project-relative path in wrap's configuration fingerprint. Identical text in two locations can resolve local sources differently, so comparing only the text can incorrectly reuse a warm workspace after a location switch. Do not expand this fix into recursive source hashing.

### 4. Validate the actual TOML output with the reader capa uses

The fresh writer and comment-preserving editor do not necessarily emit the same representation. Independently verified under local Bun: fresh iarna serialization of `[1, 2.5]` reloads, but patch emits `[1, 2.5]` and iarna rejects the integer/float mixture. Thus merely testing whether fresh serialization succeeds is insufficient.

Prepare optional nulls using existing configuration semantics, reject meaningful unsupported nulls, produce the intended output, then parse that exact string with the production reader before saving. Validate that intended values survive. Preserve the original bytes on representation failure. Mixed arrays are valid in modern TOML; rejection here must describe the installed-library compatibility limit rather than claim the language forbids them. [TOML 1.0 arrays](https://toml.io/en/v1.0.0#array).

### 5. Complete the shared lock decoding and cleanup changes

Canonical comparison cannot replace typed decoding of nullable lock metadata. Preserve that decoding and main's existing invalid-entry warning/skip policy. Match semantic identity across save and fingerprints, without applying null omission to meaningful user configuration defaults.

The current TOML sniffer misclassifies commented/reordered TOML and YAML containing TOML marker text. Use parser-backed recognition and schema validation, or validated fallback, only at the active lock path. Skip saves only when both format and values match. Ensure empty-install cleanup deletes only the active lock; migration removal from `loadLockfile` alone does not stop the install task deleting unrelated candidates.

### 6. Keep a small Browse usability decision explicit

Main hides all dot-prefixed entries, including `.config`. Preserving that filter means the UI cannot navigate into its new upload folders, although upload-returned paths and manually typed paths can still work. A narrow `.config` navigation exception is a reasonable improvement, but it changes baseline UI behavior and was not agreed during the interview. Decide it explicitly or document the limitation; do not silently add general hidden-file or external browsing.

### Bun-specific API choice

Current Bun documents both `Bun.TOML.parse` and `Bun.TOML.stringify`, and local 1.4.4 exposes both. The serialization audit found only parse in the versioned 1.3.14 declarations. Keep the supported runtime and current libraries rather than adopting a current-only native API based on latest documentation. A switch would need separate compatibility evidence and would not by itself preserve comments. [Current Bun TOML reference](https://bun.sh/reference/bun/TOML), [Bun 1.3.14 declarations](https://github.com/oven-sh/bun/blob/bun-v1.3.14/packages/bun-types/bun.d.ts).

## Research conclusion

Retain the agreed product decisions as the best fit for the stated low-disruption scope. Add the required wrap, path, parser, cleanup, and watcher details to the implementation plan. At the end of the audit, internal shadow-lock storage and `.config` Browse visibility were the two open choices.

Subsequent discussion settled both: wrap keeps a private root lock as on main, and Browse exposes the project's root `.config` directory through a narrow exception to hidden-entry filtering. See the authoritative [agreed decisions](decisions.md) and [implementation plan](implementation-plan.md). No product code has been changed as part of this research and planning.

## Architecture recommendation

Keep responsibilities concentrated in the existing modules:

- Paths: ordered configuration candidates and kind-specific upload destinations.
- Local-source conversion: convert a selected filesystem path into the stored form expected by its content type.
- Lockfile module: active path/format, parsing, validation, domain normalization, serialization, and semantic identity. Wrap and install fingerprinting reuse this behavior.
- Watcher: directory handles, event coalescing, selected-file state, and poll/reload lifecycle.

Use a consistent detected config within each operation instead of rediscovering independently for each helper call. Avoid adding Git traversal, automatic migrations, a generic configuration framework, or a recursive project-wide watcher for this PR.

Implementation verification must cover both normal installs and wrap's linked source trees, all supported config locations/formats, serialization failures that preserve original bytes, and Bun's existing CI version/platform matrix.
