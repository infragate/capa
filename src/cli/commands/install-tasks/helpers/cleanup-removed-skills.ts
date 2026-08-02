import { existsSync, rmSync } from 'fs';
import { basename, relative, resolve, sep } from 'path';
import type { Skill } from '../../../../types/capabilities';
import type { CapaDatabase } from '../../../../db/database';
import { getProvider } from '../../../../shared/providers';
import { isPathInside } from '../../../../shared/paths';

/**
 * True when `filePath` is a skill install directory for one of `providers`
 * under `projectPath` (e.g. `<project>/.cursor/skills/<id>`).
 *
 * Restricting cleanup to these paths avoids:
 * - deleting rule files that share `managed_files` (basename `foo.mdc` ≠ skill id)
 * - deleting another provider's skills during a scoped install (e.g. wrap)
 * - deleting the real project's managed paths when `projectPath` is a wrap shadow
 */
export function isProviderSkillManagedPath(
  projectPath: string,
  filePath: string,
  providers: string[],
): boolean {
  const resolvedFile = resolve(filePath);
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider?.skillsDir) continue;
    const skillsDir = resolve(projectPath, provider.skillsDir);
    if (!isPathInside(resolvedFile, skillsDir)) continue;
    const rel = relative(skillsDir, resolvedFile);
    // Managed skill entries are the skill directory itself (one level under skillsDir).
    if (!rel || rel === '' || rel.split(sep).length !== 1) continue;
    return true;
  }
  return false;
}

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
    // Only touch skill dirs for providers in this install under projectPath.
    // Rule files and other-provider / real-project paths are left alone.
    if (!isProviderSkillManagedPath(projectPath, managedPath, clients)) {
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
