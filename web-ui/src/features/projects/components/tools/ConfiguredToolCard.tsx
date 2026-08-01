import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Trash2, Pencil, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EnrichedTool, Skill } from '../../../../types/api';
import { highlightText, isFormFieldTarget } from '../../../../lib/utils';
import { SourceBadge } from '../../../../components/common/ServerBadge';
import { useUpdateCapability } from '../../hooks';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../../lib/ids';
import { skillRequiresTool, withSkillRequiresTool } from '../../../../lib/toolRefs';
import { configuredToolAnchor } from './anchors';
import { DefaultsEditor } from './DefaultsEditor';
import { FormatterEditor } from './FormatterEditor';

export function ConfiguredToolCard({
  projectId,
  tool,
  skills,
  search,
  requiredBy,
  focused,
  onSelect,
  onEditCommand,
  onDelete,
  deleting,
  dragHandle,
}: {
  projectId: string;
  tool: EnrichedTool;
  skills: Skill[];
  search: string;
  requiredBy: string[];
  focused: boolean;
  onSelect: () => void;
  onEditCommand?: () => void;
  onDelete: () => void;
  deleting: boolean;
  dragHandle?: ReactNode;
}) {
  const { t } = useTranslation('projects');
  const updateMutation = useUpdateCapability(projectId);
  const updateSkillMutation = useUpdateCapability(projectId);
  const [editingId, setEditingId] = useState(false);
  const [draftId, setDraftId] = useState(tool.id);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftDesc, setDraftDesc] = useState(tool.description || '');
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [formatterOpen, setFormatterOpen] = useState(!!tool.formatter);
  const [skillsOpen, setSkillsOpen] = useState(false);

  const displayDesc = tool.description || tool._description || '';
  const originalDesc = tool._description || '';
  const hasCustomDesc = !!(tool.description && originalDesc && tool.description !== originalDesc);
  const busy =
    updateMutation.isPending || updateSkillMutation.isPending || deleting;

  useEffect(() => {
    if (!editingDesc) setDraftDesc(tool.description || '');
  }, [tool.description, editingDesc]);

  async function saveRename() {
    const next = draftId.replace(/[^a-zA-Z0-9_-]/g, '');
    const idErr = capaIdErrorMessage(next, t);
    if (idErr || !next || next === tool.id) {
      setEditingId(false);
      setDraftId(tool.id);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        section: 'tools',
        entryId: tool.id,
        patch: { id: next },
      });
      setEditingId(false);
    } catch {
      // keep editing so user can fix
    }
  }

  async function saveDescription() {
    const next = draftDesc.trim();
    const current = (tool.description || '').trim();
    if (next === current) {
      setEditingDesc(false);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        section: 'tools',
        entryId: tool.id,
        patch: { description: next || null },
      });
      setEditingDesc(false);
    } catch {
      // keep editing so user can fix
    }
  }

  return (
    <div
      data-link-anchor={configuredToolAnchor(tool)}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-busy={busy}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (isFormFieldTarget(e.target)) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`rounded-sm border bg-bg-tertiary p-2.5 outline-none transition-colors cursor-pointer ${
        focused
          ? 'border-accent-primary ring-1 ring-accent-primary'
          : 'border-border-tertiary hover:border-border-primary'
      } ${busy ? 'opacity-80' : ''}`}
    >
      <div className="flex items-start gap-2">
        {dragHandle}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editingId ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRename();
                }}
              >
                <input
                  autoFocus
                  value={draftId}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setDraftId(sanitizeCapaIdInput(e.target.value))}
                  onBlur={() => void saveRename()}
                  className="min-w-0 flex-1 rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-0.5 font-mono text-xs text-text-primary disabled:opacity-50"
                />
              </form>
            ) : (
              <>
                <span
                  className="truncate font-mono text-xs font-medium text-text-primary"
                  dangerouslySetInnerHTML={{ __html: highlightText(tool.id, search) }}
                />
                <button
                  type="button"
                  title={t('actions.renameTool')}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDraftId(tool.id);
                    setEditingId(true);
                  }}
                  className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer disabled:opacity-50"
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
            <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-text-tertiary">
              {tool.type}
            </span>
            {busy && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
          </div>

          {editingDesc ? (
            <div
              className="mt-1 space-y-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <textarea
                autoFocus
                value={draftDesc}
                disabled={updateMutation.isPending}
                rows={focused ? 4 : 2}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder={originalDesc || t('actions.description')}
                className="w-full resize-y rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 text-[11px] text-text-primary disabled:opacity-50"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => void saveDescription()}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg disabled:opacity-50"
                >
                  {updateMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  {t('actions.saveDescription')}
                </button>
                <button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => {
                    setDraftDesc(tool.description || '');
                    setEditingDesc(false);
                  }}
                  className="rounded-sm px-2 py-1 text-[11px] text-text-tertiary hover:bg-hover-bg cursor-pointer disabled:opacity-50"
                >
                  {t('actions.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex items-start gap-1">
              {displayDesc ? (
                <p
                  className={`min-w-0 flex-1 text-[11px] text-text-secondary ${
                    focused ? '' : 'line-clamp-2'
                  }`}
                  dangerouslySetInnerHTML={{ __html: highlightText(displayDesc, search) }}
                />
              ) : (
                <p className="min-w-0 flex-1 text-[11px] italic text-text-tertiary">
                  {t('actions.noDescription')}
                </p>
              )}
              <button
                type="button"
                title={t('actions.editToolDescription')}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftDesc(tool.description || displayDesc);
                  setEditingDesc(true);
                }}
                className="shrink-0 rounded-sm p-1 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer disabled:opacity-50"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}

          {focused && hasCustomDesc && (
            <p className="mt-1 text-[10px] text-text-tertiary">
              <span className="uppercase tracking-wide">{t('actions.originalDescription')}: </span>
              {originalDesc}
            </p>
          )}

          {tool.type === 'mcp' && tool.mcpServer && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-text-tertiary">
              <SourceBadge name={tool.mcpServer.replace(/^@/, '')} kind="server" search={search} />
              <span>→</span>
              <span
                className="font-mono"
                dangerouslySetInnerHTML={{
                  __html: highlightText(tool.mcpTool || '', search),
                }}
              />
            </div>
          )}
          {tool.type === 'command' && tool.command && (
            <p
              className="mt-1 truncate font-mono text-[11px] text-text-tertiary"
              dangerouslySetInnerHTML={{ __html: highlightText(tool.command, search) }}
            />
          )}
          {tool.type === 'command' && tool.group && (
            <p className="mt-0.5 text-[10px] text-text-tertiary">
              group: <span className="font-mono">{tool.group}</span>
            </p>
          )}
          {tool.type === 'command' &&
            (tool.commandArgs || []).some((a) => a.default !== undefined) && (
              <p className="mt-0.5 text-[10px] text-text-tertiary">
                {t('actions.defaults')}:{' '}
                {(tool.commandArgs || [])
                  .filter((a) => a.default !== undefined)
                  .map((a) => `${a.name}=${JSON.stringify(a.default)}`)
                  .join(', ')}
              </p>
            )}
        </div>
        {onEditCommand && (
          <button
            type="button"
            title={t('actions.editCommandTool')}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onEditCommand();
            }}
            className="rounded-sm p-1.5 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            <Pencil size={14} />
          </button>
        )}
        <button
          type="button"
          title={t('actions.delete')}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-sm p-1.5 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer disabled:opacity-50"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>

      {tool.type === 'mcp' &&
        tool._inputSchema?.properties &&
        Object.keys(tool._inputSchema.properties).length > 0 && (
          <div className="mt-2 border-t border-border-secondary pt-1">
            <button
              type="button"
              disabled={busy && !defaultsOpen}
              onClick={(e) => {
                e.stopPropagation();
                setDefaultsOpen((v) => !v);
              }}
              className="flex w-full items-center gap-1 py-1 text-left text-[10px] uppercase tracking-wide text-text-tertiary cursor-pointer hover:text-text-secondary disabled:opacity-50"
            >
              <ChevronRight
                size={12}
                className="ui-chevron"
                data-open={defaultsOpen ? 'true' : 'false'}
              />
              {t('actions.defaults')}
              <span className="rounded-sm bg-bg-secondary px-1 py-px normal-case tracking-normal">
                {Object.keys(tool._inputSchema.properties).length}
              </span>
            </button>
            {defaultsOpen && (
              <div className="ui-panel-enter">
                <DefaultsEditor
                  tool={tool}
                  busy={updateMutation.isPending}
                  onSave={(defaults) =>
                    updateMutation.mutate({
                      section: 'tools',
                      entryId: tool.id,
                      patch: {
                        def: {
                          server: tool.mcpServer,
                          tool: tool.mcpTool,
                          defaults,
                          ...(tool.formatter ? { formatter: tool.formatter } : {}),
                        },
                      },
                    })
                  }
                />
              </div>
            )}
          </div>
        )}

      {tool.type === 'mcp' && (
        <div className="mt-1 border-t border-border-secondary pt-1">
          <button
            type="button"
            disabled={busy && !formatterOpen}
            onClick={(e) => {
              e.stopPropagation();
              setFormatterOpen((v) => !v);
            }}
            className="flex w-full items-center gap-1 py-1 text-left text-[10px] uppercase tracking-wide text-text-tertiary cursor-pointer hover:text-text-secondary disabled:opacity-50"
          >
            <ChevronRight
              size={12}
              className="ui-chevron"
              data-open={formatterOpen ? 'true' : 'false'}
            />
            {t('actions.formatter')}
            <span className="rounded-sm bg-bg-secondary px-1 py-px normal-case tracking-normal">
              {tool.formatter?.cmd ? 1 : 0}
            </span>
          </button>
          {formatterOpen && (
            <div className="ui-panel-enter">
              <FormatterEditor
                tool={tool}
                busy={updateMutation.isPending}
                onSave={(formatter) =>
                  updateMutation.mutate({
                    section: 'tools',
                    entryId: tool.id,
                    patch: {
                      def: {
                        server: tool.mcpServer,
                        tool: tool.mcpTool,
                        ...(tool.defaults ? { defaults: tool.defaults } : {}),
                        formatter,
                      },
                    },
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-1 border-t border-border-secondary pt-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSkillsOpen((v) => !v);
          }}
          className="flex w-full items-center gap-1 py-1 text-left text-[10px] uppercase tracking-wide text-text-tertiary cursor-pointer hover:text-text-secondary"
        >
          <ChevronRight
            size={12}
            className="ui-chevron"
            data-open={skillsOpen ? 'true' : 'false'}
          />
          {t('actions.associatedSkills')}
          <span className="rounded-sm bg-bg-secondary px-1 py-px normal-case tracking-normal">
            {requiredBy.length}
          </span>
        </button>
        {skillsOpen && (
          <div className="ui-panel-enter pb-1">
            <div className="mt-1 flex flex-wrap gap-1">
              {skills.map((skill) => {
                const checked = skillRequiresTool(skill.requires, tool);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    disabled={!!skill.sourcePlugin || updateSkillMutation.isPending || deleting}
                    onClick={() => {
                      const next = withSkillRequiresTool(skill.requires, tool, !checked);
                      updateSkillMutation.mutate({
                        section: 'skills',
                        entryId: skill.id,
                        patch: { def: { requires: next } },
                      });
                    }}
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] cursor-pointer disabled:opacity-40 ${
                      checked
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-bg-secondary text-text-tertiary hover:bg-hover-bg'
                    }`}
                  >
                    {skill.id}
                  </button>
                );
              })}
              {skills.length === 0 && (
                <span className="text-[10px] text-text-tertiary">{t('actions.emptySkills')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
