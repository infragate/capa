import { useTranslation } from 'react-i18next';
import type { Skill } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { sourceTypeBadgeClasses } from './sourceTypeColors';

interface SkillsListProps {
  skills: Skill[];
  search: string;
}

export function SkillsList({ skills, search }: SkillsListProps) {
  const { t } = useTranslation('projects');
  const visible = skills.filter((s) => matchesSearch([s.id, s.description], search));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <span>{t('detail.skills')}</span>
        <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {visible.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noSkillsMatch') : t('detail.noSkills')}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((skill) => (
            <div key={skill.id} className="rounded-sm border border-border-tertiary bg-bg-tertiary p-3">
              <div
                className="mb-1 font-mono text-[13px] font-medium text-text-primary"
                dangerouslySetInnerHTML={{ __html: highlightText(skill.id, search) }}
              />
              <div className="mb-1 flex items-center gap-2 text-xs text-text-secondary">
                <span
                  className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase ${sourceTypeBadgeClasses(skill.type)}`}
                >
                  {skill.type}
                </span>
              </div>
              {skill.description && (
                <div
                  className="mt-1 text-xs leading-relaxed text-text-secondary"
                  dangerouslySetInnerHTML={{ __html: highlightText(skill.description, search) }}
                />
              )}
              {skill.sourcePlugin?.name && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                  <span>from</span>
                  <SourceBadge name={skill.sourcePlugin.name} kind="plugin" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
