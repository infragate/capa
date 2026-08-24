import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { Skill, ToolCallRecord } from '../../../../types/api';
import { SkillDetailDialog } from '../SkillDetailDialog';
import { collectRunSkillFolders } from './buildRunFileTree';

interface ActivityRunSkillsPanelProps {
  events: ToolCallRecord[];
  projectPath: string | null;
  projectId?: string | null;
  /** Skills managed by capa for this project — used to make chips clickable. */
  managedSkills?: Skill[];
}

/** Match a detected skill folder to a capa-managed skill id when possible. */
export function findManagedSkillForFolder(
  folder: string,
  managedSkills: Skill[] | undefined,
): Skill | null {
  if (!managedSkills?.length) return null;
  const exact = managedSkills.find((s) => s.id === folder);
  if (exact) return exact;

  const lower = folder.toLowerCase();
  const byIdIgnoreCase = managedSkills.find((s) => s.id.toLowerCase() === lower);
  if (byIdIgnoreCase) return byIdIgnoreCase;

  // Local skills may use a path whose basename matches the folder.
  for (const skill of managedSkills) {
    const path = skill.path?.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!path) continue;
    const base = path.split('/').filter(Boolean).pop();
    if (base === folder || base?.toLowerCase() === lower) return skill;
  }
  return null;
}

export function ActivityRunSkillsPanel({
  events,
  projectPath,
  projectId = null,
  managedSkills = [],
}: ActivityRunSkillsPanelProps) {
  const { t } = useTranslation('projects');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const skills = useMemo(
    () => collectRunSkillFolders(events, { realProjectPath: projectPath }),
    [events, projectPath],
  );

  return (
    <aside
      className="flex max-h-[min(38%,220px)] min-h-0 shrink-0 flex-col border-t border-border-secondary bg-bg-tertiary/40"
      aria-label={t('activity.runSkills.aria')}
    >
      <div className="shrink-0 border-b border-border-secondary/80 px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          {t('activity.runSkills.heading')}
        </h3>
        <p className="mt-0.5 text-[10px] leading-snug text-text-tertiary">
          {skills.length === 0
            ? t('activity.runSkills.empty')
            : t('activity.runSkills.count', { count: skills.length })}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {skills.length === 0 ? (
          <p className="text-[10px] leading-snug text-text-tertiary">
            {t('activity.runSkills.emptyHint')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {skills.map((skillFolder) => {
              const managed = findManagedSkillForFolder(skillFolder, managedSkills);
              const chipClass =
                'inline-flex max-w-full items-center gap-1 rounded-full border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[11px] font-medium leading-none text-accent-primary';
              return (
                <li key={skillFolder}>
                  {managed && projectId ? (
                    <button
                      type="button"
                      className={`${chipClass} cursor-pointer transition-colors hover:border-accent-primary/50 hover:bg-accent-primary/20`}
                      title={t('activity.runSkills.openSkill', { id: managed.id })}
                      onClick={() => setSelectedSkill(managed)}
                    >
                      <Sparkles size={10} className="shrink-0 opacity-80" aria-hidden />
                      <span className="truncate">{skillFolder}</span>
                    </button>
                  ) : (
                    <span className={chipClass} title={skillFolder}>
                      <Sparkles size={10} className="shrink-0 opacity-80" aria-hidden />
                      <span className="truncate">{skillFolder}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {projectId && (
        <SkillDetailDialog
          skill={selectedSkill}
          projectId={projectId}
          open={!!selectedSkill}
          onOpenChange={(next) => {
            if (!next) setSelectedSkill(null);
          }}
        />
      )}
    </aside>
  );
}
