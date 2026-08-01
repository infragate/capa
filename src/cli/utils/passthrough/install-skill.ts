import { join } from 'path';
import { installOneSkill } from '../../commands/install-tasks/helpers/install-one-skill';
import { LockfileBuilder } from '../../../shared/lockfile';
import { getProvider } from '../../../shared/providers';
import { emptyCapabilities } from './env';
import type { CapaDatabase } from '../../../db/database';
import type { loadSettings } from '../../../shared/config';
import type { Skill } from '../../../types/capabilities';

export async function passthroughInstallSkill(opts: {
  skill: Skill;
  projectPath: string;
  projectId: string;
  providers: string[];
  db: CapaDatabase;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  noCache: boolean;
  written: string[];
}): Promise<void> {
  const { skill, projectPath, projectId, providers, db, settings, noCache, written } = opts;
  const caps = emptyCapabilities(providers);
  const lockBuilder = new LockfileBuilder(null);
  const outcome = await installOneSkill(
    skill,
    projectPath,
    projectId,
    providers,
    db,
    settings,
    caps,
    join(projectPath, 'capabilities.yaml'),
    lockBuilder,
    noCache,
    new Map(),
    { trackManaged: false },
  );
  if (outcome === 'installed') {
    for (const pid of providers) {
      const prov = getProvider(pid);
      if (prov) written.push(join(projectPath, prov.skillsDir, skill.id));
    }
    console.log(`✓ Passthrough: installed skill "${skill.id}"`);
  } else {
    console.log(`⚠ Skill "${skill.id}" was skipped (${outcome})`);
  }
}
