# PR #383: config watcher research

Research only. Reviewed `src/server/capabilities-watcher.ts` and candidate ordering in `src/shared/paths.ts`.

## Bun runtime and main-branch reference

- Upstream `main` was refreshed and remains `d7af1197d4214599b8143794212b6094c9096d99`. Its watcher already uses `fs.watch`, a 400 ms debounce, a 1.5-second modification-time poll, and self-write suppression. Retain that model rather than introducing a new runtime or watcher package. [Main watcher](https://github.com/infragate/capa/blob/d7af1197d4214599b8143794212b6094c9096d99/src/server/capabilities-watcher.ts).
- Bun documents `node:fs` as supported and recommends it for directories. Its watcher guide explicitly documents shallow watching by default and an opt-in recursive watch. Three targeted directory watches fit this PR better than recursively watching unrelated project trees. This last statement is a design judgment, not a Bun requirement. [Bun compatibility](https://bun.sh/docs/runtime/nodejs-compat), [Bun directory I/O](https://bun.sh/docs/runtime/file-io#directories), [Bun watch guide](https://bun.sh/guides/read-file/watch).
- Local reproductions use Bun 1.4.4 on Linux. The project's CI pins Bun 1.3.14 on Linux, macOS, and Windows. These reproductions do not establish behavior on that full matrix. [CI definition](../../.github/workflows/test.yml).
- A local Bun reproduction of first-config creation selected the new file but invoked the reload handler zero times after 950 ms. The current code initializes its stored modification time to the newly selected file's time, then suppresses the scheduled reload as unchanged. Treat first selection and winner switches as explicit reload reasons rather than relying only on differing timestamps. This is a proposed implementation refinement within the agreed watcher behavior, not evidence that Bun dropped the event.

## Official documented behavior (not delivery guarantees)

- **Directory creation/deletion:** Bun documents shallow watching by default; descendants require recursive watching or separate watches. Its API reference says `rename` covers filenames appearing/disappearing **on most platforms**, not universally. [Bun guide](https://bun.sh/guides/read-file/watch), [Bun fs.watch reference](https://bun.sh/reference/node/fs/watch).
- **Missing filename:** Node explicitly says the callback filename is not guaranteed, even on supported platforms. Bun's callback type also permits `null`. [Node filename caveat](https://nodejs.org/api/fs.html#filename-argument), [Bun fs.watch reference](https://bun.sh/reference/node/fs/watch).
- **Inode replacement:** Node documents that Linux/macOS watches follow the original inode after deletion/recreation, emitting deletion but not events for the new inode. This applies to watched paths, including directories. [Node inode caveat](https://nodejs.org/api/fs.html#inodes).
- **Windows:** Node documents no events when the watched directory moves/is renamed, and `EPERM` when it is deleted. Node uses `ReadDirectoryChangesW`; Microsoft documents discarded notifications on buffer overflow and recommends directory enumeration for recovery, including `ERROR_NOTIFY_ENUM_DIR`. This establishes an underlying loss mode, not a guarantee about which JS callback/error exposes it. [Node caveats](https://nodejs.org/api/fs.html#caveats), [Microsoft API documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw).
- **Mtime:** Node documents platform-dependent timestamp precision and allows setting mtime explicitly. Mtime is therefore not a unique content/version identifier. [Node stat times](https://nodejs.org/api/fs.html#stat-time-values), [Node utimes](https://nodejs.org/api/fs.html#fsutimespath-atime-mtime-callback).

Bun's guide links to Node's documentation, but the cited Bun pages do not independently promise identical platform edge behavior or lossless event delivery. Treat Node's detailed caveats as portability constraints, not proof of Bun's internal implementation.

## Local findings

- `checkMtime()` currently runs full discovery every 1.5 seconds; `fire()` also rediscovers before reloading. Removing periodic discovery changes recovery behavior.
- `watchProject()` returns early when the project and winner match and any handle exists. It can therefore skip adding a newly created directory watch or replacing a stale handle. Reported local reproduction: root `capabilities.yaml`, one handle; create `.config`, call `watchProject()` again; still one handle rather than two.
- The root callback accepts `.config` events, but the `.config` callback filters for candidate **file** basenames. Creation/deletion of its `capabilities` child directory is ignored. The proposed `capa` child needs explicit handling after the location rename. Error handlers currently only log.

## Design recommendations (inferences, not API guarantees)

- Keep the 1.5-second poll limited to the active pathname. Rediscover exceptionally when that file disappears or a watcher errors; distinguish missing files from other stat failures.
- On relevant events, rediscover candidates and reconcile directory watches independently of whether the winning file changed. Watch existing ancestors so missing directories can later acquire watches. Handle structural `.config` and nested config-directory creation/deletion; invalidate stale handles after replacement.
- Treat a missing filename as a broad rediscovery/reconciliation trigger, as the current callback already does. Debounce work and reconcile current filesystem state rather than interpreting events as a complete history.
- Polling the active pathname can recover a missed edit/replacement only when the observed mtime changes. Preserved/equal timestamps and changes between samples can escape detection. Parent-directory watches avoid relying on a watch attached directly to a replaced file, but replaced watched directories still require rebinding.

**Limitation accepted during the design discussion:** if creation of a new higher-priority candidate is missed while the active file remains present and unchanged, active-file mtime polling cannot detect it. For example, root `capabilities.toml` can appear while root `capabilities.yaml` stays active. With no later relevant event, error, or explicit refresh, selection can remain stale indefinitely. The same issue applies to first-config creation when there is no active file. Event-driven reconciliation improves coverage but cannot remove this limitation; exceptional rediscovery does not help when no exception occurs. See [agreed decisions](decisions.md).
