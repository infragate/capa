import { existsSync, readFileSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import type { Hook } from '../../../types/hooks';
import type { LockHookEntry } from '../../../types/lockfile';
import type { InstallHooksOptions } from './install';
import { fetchRepoFile, fetchTextFile } from '../../../shared/repo-file';
import { sha256 } from './json-io';

export interface ResolvedHookBody {
  /**
   * Resolved body text. For command-type `local` sources this is left empty
   * — the script already exists on disk at `localPath` and we reference it
   * directly instead of copying it into ~/.capa. For prompt-type `local`
   * sources the file *is* the prompt text, so it's read in full here.
   */
  text: string;
  /**
   * True when the body needs to be written to a script file under
   * ~/.capa/hooks/<projectId>/. False for inline `command:` (no source)
   * and for `local` sources (we reuse the user's file).
   */
  needsMaterialisation: boolean;
  /**
   * Set for `source.type='local'`: the absolute path of the user's script.
   * The provider entry's `command` points at this file (project-relative when
   * it lives inside the project — see toPortableHookReference — otherwise
   * absolute), so the user's file becomes the live hook script: no copy in
   * ~/.capa, no scriptPath tracked in `managed_hooks`, no chmod, and edits to
   * the file take effect immediately without re-running `capa install`.
   */
  localPath?: string;
  /** Optional lockfile pin for remote / repo sources. */
  lockEntry?: LockHookEntry;
}

export async function resolveHookBody(hook: Hook, opts: InstallHooksOptions): Promise<ResolvedHookBody> {
  const isCommand = (hook.type ?? 'command') === 'command';

  if (!hook.source) {
    return { text: hook.command ?? hook.prompt ?? '', needsMaterialisation: false };
  }
  const source = hook.source;
  let text = '';
  let lockEntry: LockHookEntry | undefined;

  switch (source.type) {
    case 'inline': {
      text = source.content ?? '';
      break;
    }
    case 'remote': {
      if (!source.url) throw new Error('source.type=remote requires url');
      text = await fetchTextFile(source.url, {
        authFetch: opts.authFetch,
        sourceLabel: `hook "${hook.id}"`,
      });
      lockEntry = {
        id: hook.id,
        source: 'remote',
        repo: null,
        url: source.url,
        requestedVersion: null,
        requestedRef: null,
        resolvedRef: null,
        resolvedVersion: null,
        bodySha256: sha256(text),
      };
      break;
    }
    case 'github':
    case 'gitlab': {
      if (!source.def?.repo) throw new Error(`source.type=${source.type} requires def.repo`);
      const result = await fetchRepoFile(source.type, source.def.repo, opts.getRepoSnapshot, opts.authFetch, {
        noCache: opts.noCache,
      });
      text = result.content;
      lockEntry = {
        id: hook.id,
        source: source.type,
        repo: result.parsed.ownerRepo,
        url: null,
        requestedVersion: result.parsed.version ?? null,
        requestedRef: result.parsed.sha ?? null,
        resolvedRef: result.resolvedSha,
        resolvedVersion: result.resolvedVersion ?? null,
        bodySha256: sha256(text),
      };
      break;
    }
    case 'local': {
      if (!source.path) throw new Error('source.type=local requires path');
      const baseDir = dirname(opts.capabilitiesFilePath);
      const fullPath = resolvePath(baseDir, source.path);
      if (!existsSync(fullPath)) throw new Error(`local file does not exist: ${fullPath}`);
      if (!isCommand) {
        return { text: readFileSync(fullPath, 'utf-8'), needsMaterialisation: false };
      }
      return { text: '', needsMaterialisation: false, localPath: fullPath };
    }
  }

  return { text, needsMaterialisation: isCommand, lockEntry };
}
