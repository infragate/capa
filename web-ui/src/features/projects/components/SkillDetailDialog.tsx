import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, Loader2, Pencil, X } from 'lucide-react';
import { FaGithub, FaGitlab } from 'react-icons/fa';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Skill } from '../../../types/api';
import { Spinner } from '../../../components/common/Spinner';
import { FileTree } from '../../../components/common/FileTree';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { useSkillContent, useUpdateCapability } from '../hooks';
import { sourceTypeBadgeClasses } from './sourceTypeColors';

interface SkillDetailDialogProps {
  skill: Skill | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function renderMarkdown(md: string): string {
  const raw = marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

function sourceHostKind(raw: string | null | undefined): 'github' | 'gitlab' | 'remote' {
  if (!raw) return 'remote';
  try {
    const hostname = new URL(raw).hostname;
    if (hostname === 'github.com' || hostname.endsWith('.github.com') || hostname === 'raw.githubusercontent.com') {
      return 'github';
    }
    if (hostname === 'gitlab.com' || hostname.endsWith('.gitlab.com')) {
      return 'gitlab';
    }
  } catch {
    // fall through
  }
  return 'remote';
}

export function SkillDetailDialog({ skill, projectId, open, onOpenChange }: SkillDetailDialogProps) {
  const { t } = useTranslation('projects');
  const { data, isLoading, isError } = useSkillContent(projectId, open && skill ? skill.id : null);
  const updateMutation = useUpdateCapability(projectId);
  const canEdit = skill?.type === 'inline' && !skill.sourcePlugin;
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setError(null);
      return;
    }
    setDraftContent(data?.content || skill?.content || '');
    setDraftDescription(skill?.description || '');
  }, [open, skill?.id, skill?.content, skill?.description, data?.content]);

  const previewHtml = useMemo(
    () => (data?.content ? renderMarkdown(data.content) : ''),
    [data?.content],
  );

  const sourceUrl = skill?.sourceUrl || null;
  const sourceKind = sourceHostKind(sourceUrl);
  const sourceTitle =
    sourceKind === 'github'
      ? t('openOnGitHub')
      : sourceKind === 'gitlab'
        ? t('openOnGitLab')
        : t('skillDetail.viewSource');

  async function handleSave() {
    if (!skill) return;
    setError(null);
    if (!draftContent.trim()) {
      setError(t('actions.skillInlineRequired'));
      return;
    }
    try {
      await updateMutation.mutateAsync({
        section: 'skills',
        entryId: skill.id,
        patch: {
          id: skill.id,
          type: 'inline',
          description: draftDescription.trim() || undefined,
          def: {
            content: draftContent.trim(),
            description: draftDescription.trim() || skill.id,
          },
        },
      });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[90vh] w-[min(90vw,720px)] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
          <div className="flex items-start justify-between border-b border-border-secondary px-6 py-4">
            <div className="min-w-0 flex-1 pr-4">
              <Dialog.Title className="truncate font-mono text-lg font-medium text-text-primary">
                {skill?.id ?? t('skillDetail.title')}
              </Dialog.Title>
                  {skill && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${sourceTypeBadgeClasses(skill.type)}`}
                  >
                    {skill.type}
                  </span>
                  {skill.path && (
                    <span className="truncate font-mono text-[11px] text-text-tertiary" title={skill.path}>
                      {skill.path}
                    </span>
                  )}
                  {skill.sourcePlugin?.name && (
                    <SourceBadge name={skill.sourcePlugin.name} kind="plugin" />
                  )}
                </div>
              )}
              <Dialog.Description className="sr-only">
                {t('skillDetail.description')}
              </Dialog.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canEdit && !editing && (
                <button
                  type="button"
                  title={t('actions.editSkill')}
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t('actions.edit')}
                </button>
              )}
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary"
                  title={sourceTitle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {sourceKind === 'github' ? (
                    <FaGithub className="h-4 w-4" />
                  ) : sourceKind === 'gitlab' ? (
                    <FaGitlab className="h-4 w-4" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  <span>{t('skillDetail.viewSource')}</span>
                </a>
              )}
              <Dialog.Close
                className="rounded-sm p-1 text-text-secondary transition-colors hover:bg-hover-bg"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {editing ? (
              <div className="space-y-3">
                {error && <p className="text-xs text-error-text">{error}</p>}
                <label className="block text-xs text-text-secondary">
                  {t('actions.description')}
                  <input
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
                  />
                </label>
                <label className="block text-xs text-text-secondary">
                  {t('actions.skillContent')}
                  <textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    rows={16}
                    className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-xs text-text-primary"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={updateMutation.isPending}
                    onClick={() => void handleSave()}
                    className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
                  >
                    {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                    {t('actions.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setDraftContent(data?.content || skill?.content || '');
                      setDraftDescription(skill?.description || '');
                      setError(null);
                    }}
                    className="rounded-sm px-3 py-2 text-xs text-text-secondary hover:bg-hover-bg cursor-pointer"
                  >
                    {t('actions.cancel', { defaultValue: 'Cancel' })}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {isLoading && <Spinner label={t('skillDetail.loading')} />}
                {!isLoading && isError && (
                  <div className="py-12 text-center text-sm text-text-tertiary">
                    {t('skillDetail.unavailable')}
                  </div>
                )}
                {!isLoading && !isError && previewHtml && (
                  <div className="space-y-5">
                    {data?.files && data.files.length > 0 && (
                      <section>
                        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                          {t('skillDetail.files')}
                        </h3>
                        <FileTree files={data.files} />
                      </section>
                    )}
                    <div
                      className="registry-markdown overflow-hidden text-sm text-text-secondary"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                )}
                {!isLoading && !isError && !previewHtml && (
                  <div className="py-12 text-center text-sm text-text-tertiary">
                    {t('skillDetail.unavailable')}
                  </div>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
