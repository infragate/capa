import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { collectRunSkillFolders } from './buildRunFileTree';

interface ActivityRunSkillsPanelProps {
  events: ToolCallRecord[];
  projectPath: string | null;
}

export function ActivityRunSkillsPanel({
  events,
  projectPath,
}: ActivityRunSkillsPanelProps) {
  const { t } = useTranslation('projects');

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
            {skills.map((skill) => (
              <li key={skill}>
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[11px] font-medium leading-none text-accent-primary"
                  title={skill}
                >
                  <Sparkles size={10} className="shrink-0 opacity-80" aria-hidden />
                  <span className="truncate">{skill}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
