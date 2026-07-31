import { useState } from 'react';
import { Trash2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Skill } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { ReorderableList } from '../../../components/common/ReorderableList';
import { sourceTypeBadgeClasses } from './sourceTypeColors';
import { SkillDetailDialog } from './SkillDetailDialog';
import { useDeleteCapability, useReorderCapability } from '../hooks';

interface SkillsListProps {
  skills: Skill[];
  search: string;
  projectId: string;
}

export function SkillsList({ skills, search, projectId }: SkillsListProps) {
  const { t } = useTranslation('projects');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const searching = !!search.trim();
  const visible = skills.filter((s) => matchesSearch([s.id, s.description], search));

  return (
    <div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noSkillsMatch') : t('actions.emptySkills')}
        </div>
      ) : (
        <ReorderableList
          items={visible}
          getId={(s) => s.id}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) => reorderMutation.mutate({ section: 'skills', ids })}
          renderItem={(skill, { handle }) => {
            const locked = !!skill.sourcePlugin;
            return (
              <div className="flex w-full items-stretch gap-1 rounded-sm border border-border-tertiary bg-bg-tertiary pl-1">
                {handle}
                <button
                  type="button"
                  onClick={() => setSelectedSkill(skill)}
                  className="min-w-0 flex-1 p-3 text-left ui-row-hover hover:bg-hover-bg cursor-pointer"
                >
                  <div className="mb-1 flex items-center gap-2 min-w-0">
                    <span
                      className="truncate font-mono text-[13px] font-medium text-text-primary"
                      title={skill.id}
                      dangerouslySetInnerHTML={{ __html: highlightText(skill.id, search) }}
                    />
                    <span
                      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${sourceTypeBadgeClasses(skill.type)}`}
                    >
                      {skill.type}
                    </span>
                  </div>
                  {skill.description && (
                    <div
                      className="mt-1 text-xs leading-relaxed text-text-secondary"
                      dangerouslySetInnerHTML={{
                        __html: highlightText(skill.description, search),
                      }}
                    />
                  )}
                  {skill.sourcePlugin?.name && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      <span>from</span>
                      <SourceBadge name={skill.sourcePlugin.name} kind="plugin" />
                    </div>
                  )}
                </button>
                <div className="flex items-center pr-2">
                  {locked ? (
                    <span title={t('actions.pluginLocked')} className="p-2 text-text-tertiary">
                      <Lock size={14} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={t('actions.delete')}
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm(t('actions.confirmDeleteSkill', { id: skill.id }))) {
                          deleteMutation.mutate({ section: 'skills', entryId: skill.id });
                        }
                      }}
                      className="rounded-sm p-2 text-text-tertiary transition-colors hover:bg-error-bg hover:text-error-text cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          }}
        />
      )}

      <SkillDetailDialog
        skill={selectedSkill}
        projectId={projectId}
        open={!!selectedSkill}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null);
        }}
      />
    </div>
  );
}
