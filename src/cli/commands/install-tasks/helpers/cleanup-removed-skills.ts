import { existsSync, rmSync } from 'fs';
import { basename } from 'path';
import type { Skill } from '../../../../types/capabilities';
import type { CapaDatabase } from '../../../../db/database';
import { isProviderRulesManagedPath } from '../../../utils/rules-installer';

// Clean up skill directories for skills that have been removed from capabilities.
export async function cleanupRemovedSkills(
  projectPath: string,
  projectId: string,
  skills: Skill[],
  clients: string[],
  db: CapaDatabase,
): Promise<{ removed: number; skipped: number; failed: number }> {
  const stats = { removed: 0, skipped: 0, failed: 0 };
  const managedFiles = db.getManagedFiles(projectId);

  if (managedFiles.length === 0) return stats;

  const currentSkillIds = new Set(skills.map((s) => s.id));
  const dirsToRemove: string[] = [];

  for (const managedPath of managedFiles) {
    // Rule files share the managed-files table but are pruned in step 3.5
    if (isProviderRulesManagedPath(projectPath, managedPath, clients)) {
      continue;
    }

    // Managed paths are typically: /path/to/project/.agents/skills/skill-id
    const skillId = basename(managedPath);

    if (!currentSkillIds.has(skillId)) {
      dirsToRemove.push(managedPath);
    }
  }

  if (dirsToRemove.length === 0) return stats;

  for (const dir of dirsToRemove) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        stats.removed++;
      } catch {
        stats.failed++;
        continue;
      }
    }
    db.removeManagedFile(projectId, dir);
  }

  return stats;
}
