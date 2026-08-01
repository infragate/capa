import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Skill, SubAgent, Tool } from '../../../types/api';
import { matchesSearch } from '../../../lib/utils';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../lib/ids';
import { refMatchesTool, skillRequiresRef } from '../../../lib/toolRefs';
import { ReorderableList } from '../../../components/common/ReorderableList';
import { useAppendCapability, useDeleteCapability, useReorderCapability, useUpdateCapability } from '../hooks';

interface SubagentsListProps {
  subagents: SubAgent[];
  skills: Skill[];
  tools: Tool[];
  search: string;
  projectId: string;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export function SubagentsList({
  subagents,
  skills,
  tools,
  search,
  projectId,
  addOpen,
  onAddOpenChange,
}: SubagentsListProps) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const [editing, setEditing] = useState<SubAgent | null>(null);
  const searching = !!search.trim();
  const visible = subagents.filter((s) =>
    matchesSearch([s.id, s.description, s.instructions, ...s.skills, ...s.tools], search),
  );

  return (
    <div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noSubagentsMatch') : t('actions.emptySubagents')}
        </div>
      ) : (
        <ReorderableList
          items={visible}
          getId={(a) => a.id}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) => reorderMutation.mutate({ section: 'subagents', ids })}
          renderItem={(agent, { handle }) => (
            <div className="flex items-start gap-1 rounded-sm border border-border-tertiary bg-bg-tertiary p-3 pl-1">
              {handle}
              <button
                type="button"
                className="min-w-0 flex-1 text-left cursor-pointer"
                onClick={() => setEditing(agent)}
              >
                <div className="font-mono text-[13px] font-medium text-text-primary">{agent.id}</div>
                {agent.description && (
                  <p className="mt-1 text-xs text-text-secondary">{agent.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {agent.skills.map((s) => (
                    <span key={s} className="rounded-sm bg-accent-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-primary">
                      {s}
                    </span>
                  ))}
                  {agent.tools.map((toolId) => (
                    <span key={toolId} className="rounded-sm bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
                      {toolId}
                    </span>
                  ))}
                </div>
              </button>
              <button
                type="button"
                title={t('actions.delete')}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm(t('actions.confirmDeleteSubagent', { id: agent.id }))) {
                    deleteMutation.mutate({ section: 'subagents', entryId: agent.id });
                  }
                }}
                className="rounded-sm p-2 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        />
      )}

      <SubagentDialog
        open={addOpen || !!editing}
        initial={editing}
        skills={skills}
        tools={tools}
        projectId={projectId}
        busy={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            onAddOpenChange(false);
            setEditing(null);
          }
        }}
        onUpdate={async (entryId, patch) => {
          await updateMutation.mutateAsync({ section: 'subagents', entryId, patch });
        }}
      />
    </div>
  );
}

function SubagentDialog({
  open,
  initial,
  skills,
  tools,
  projectId,
  onOpenChange,
  onUpdate,
  busy,
}: {
  open: boolean;
  initial: SubAgent | null;
  skills: Skill[];
  tools: Tool[];
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onUpdate: (entryId: string, patch: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation('projects');
  const appendMutation = useAppendCapability(projectId);
  const isEdit = !!initial;
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setId(initial?.id || '');
    setDescription(initial?.description || '');
    setInstructions(initial?.instructions || '');
    setSelectedSkills(initial?.skills || []);
    setSelectedTools(initial?.tools || []);
    setError(null);
  }, [open, initial]);

  function toggleTool(tool: Tool) {
    const ref = skillRequiresRef(tool);
    setSelectedTools((list) => {
      const has = list.some((r) => refMatchesTool(r, tool));
      if (has) return list.filter((r) => !refMatchesTool(r, tool));
      return [...list.filter((r) => !refMatchesTool(r, tool)), ref];
    });
  }

  function toggleSkill(skillId: string) {
    setSelectedSkills((list) =>
      list.includes(skillId) ? list.filter((v) => v !== skillId) : [...list, skillId],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    const entry = {
      id: id.trim(),
      description: description.trim() || undefined,
      instructions: instructions.trim() || undefined,
      skills: selectedSkills,
      tools: selectedTools,
    };
    try {
      if (isEdit && initial) {
        await onUpdate(initial.id, entry);
      } else {
        await appendMutation.mutateAsync({ section: 'subagents', entry });
      }
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pending = busy || appendMutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 max-h-[90vh] w-[min(560px,92vw)] overflow-y-auto rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {isEdit ? t('actions.editSubagent') : t('actions.addSubagent')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {error && <p className="mb-3 text-xs text-error-text">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs text-text-secondary">
              ID
              <input
                value={id}
                disabled={isEdit}
                onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary disabled:opacity-60"
              />
            </label>
            <label className="block text-xs text-text-secondary">
              {t('actions.description')}
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
              />
            </label>
            <label className="block text-xs text-text-secondary">
              {t('actions.instructions')}
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-xs text-text-primary"
              />
            </label>
            <div>
              <div className="mb-1 text-xs text-text-secondary">{t('detail.skills')}</div>
              <div className="flex flex-wrap gap-1">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] cursor-pointer ${
                      selectedSkills.includes(skill.id)
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-bg-tertiary text-text-tertiary'
                    }`}
                  >
                    {skill.id}
                  </button>
                ))}
                {skills.length === 0 && (
                  <span className="text-[11px] text-text-tertiary">{t('actions.emptySkills')}</span>
                )}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-text-secondary">{t('detail.configuredTools')}</div>
              <div className="flex flex-wrap gap-1">
                {tools.map((tool) => {
                  const checked = selectedTools.some((r) => refMatchesTool(r, tool));
                  return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] cursor-pointer ${
                      checked
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-bg-tertiary text-text-tertiary'
                    }`}
                  >
                    {tool.id}
                  </button>
                  );
                })}
                {tools.length === 0 && (
                  <span className="text-[11px] text-text-tertiary">{t('actions.emptyTools')}</span>
                )}
              </div>
            </div>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? t('actions.save') : t('actions.add')}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
