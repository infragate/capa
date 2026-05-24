import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { Task } from '../../ui';
import { saveLockfile } from '../../../shared/lockfile';
import type { InstallCtx } from './context';

export function writeLockfileTask(): Task<InstallCtx> {
  return {
    title: 'Writing lockfile',
    task: async (ctx) => {
      const skillIdsForLock = new Set(
        ctx.capabilities.skills
          .filter((s) => s.type === 'github' || s.type === 'gitlab')
          .map((s) => s.id),
      );
      const pluginIdsForLock = new Set(
        (ctx.capabilitiesToUse.resolvedPlugins ?? []).map((p) => p.id),
      );
      // Hooks with a remote/repo source are pinned in the lockfile; inline /
      // local hooks travel inside the capabilities file or workspace and
      // don't need pinning.
      const hookIdsForLock = new Set(
        (ctx.capabilitiesToUse.hooks ?? [])
          .filter((h) => {
            const t = (h as { source?: { type?: string } }).source?.type;
            return t === 'github' || t === 'gitlab' || t === 'remote';
          })
          .map((h) => (h as { id: string }).id),
      );
      ctx.lockBuilder.pruneToIds(skillIdsForLock, pluginIdsForLock, hookIdsForLock);
      const lockfileToSave = ctx.lockBuilder.build();
      if (
        lockfileToSave.skills.length === 0 &&
        lockfileToSave.plugins.length === 0 &&
        lockfileToSave.hooks.length === 0
      ) {
        try {
          const lockPath = join(ctx.projectPath, 'capabilities.lock');
          if (existsSync(lockPath)) {
            rmSync(lockPath, { force: true });
          }
        } catch {}
      } else {
        try {
          await saveLockfile(ctx.projectPath, lockfileToSave);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.warnings.push(`Failed to write capabilities.lock: ${message}`);
        }
      }
    },
  };
}
