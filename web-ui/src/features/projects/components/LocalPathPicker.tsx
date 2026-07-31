import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, FolderOpen, Loader2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { projectsApi } from '../api';
import type { ProjectFsEntry } from '../../../types/api';

export interface LocalPathPickerProps {
  projectId: string;
  value: string;
  onChange: (path: string) => void;
  /** Filter listed files by extension (e.g. `md`). */
  ext?: string;
  /** Only list directories (for picking skill folders). */
  dirsOnly?: boolean;
  /** When uploading, write as a skill directory with SKILL.md. */
  uploadAsSkillDir?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function LocalPathPicker({
  projectId,
  value,
  onChange,
  ext,
  dirsOnly,
  uploadAsSkillDir,
  disabled,
  placeholder,
}: LocalPathPickerProps) {
  const { t } = useTranslation('projects');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<ProjectFsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await projectsApi.listFs(projectId, { path, ext, dirsOnly });
        setCwd(res.path);
        setEntries(res.entries);
      } catch (err) {
        setError((err as Error).message);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId, ext, dirsOnly],
  );

  useEffect(() => {
    if (browseOpen) void load('');
  }, [browseOpen, load]);

  async function handleUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await projectsApi.uploadFs(projectId, file, {
        asSkillDir: uploadAsSkillDir,
      });
      onChange(res.path);
      setBrowseOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const parentPath = cwd.includes('/') ? cwd.slice(0, cwd.lastIndexOf('/')) : '';

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder || t('actions.localPathPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-xs text-text-primary disabled:opacity-60"
        />
        <button
          type="button"
          disabled={disabled}
          title={t('actions.browse')}
          onClick={() => setBrowseOpen(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border-tertiary px-2.5 py-2 text-xs text-text-secondary hover:bg-hover-bg cursor-pointer disabled:opacity-50"
        >
          <FolderOpen size={14} />
          {t('actions.browse')}
        </button>
        <label className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border-tertiary px-2.5 py-2 text-xs text-text-secondary hover:bg-hover-bg cursor-pointer disabled:opacity-50">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {t('actions.upload')}
          <input
            type="file"
            className="hidden"
            accept={ext ? `.${ext}` : undefined}
            disabled={disabled || uploading}
            onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <Dialog.Root open={browseOpen} onOpenChange={setBrowseOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-[60] bg-black/40" />
          <Dialog.Content className="ui-dialog fixed z-[70] flex h-[min(480px,80vh)] w-[min(440px,92vw)] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-xl">
            <div className="flex items-center justify-between border-b border-border-secondary px-4 py-3">
              <Dialog.Title className="text-sm font-medium text-text-primary">
                {t('actions.browseProject')}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
            <div className="flex items-center gap-2 border-b border-border-secondary px-4 py-2 text-[11px] text-text-tertiary">
              <button
                type="button"
                disabled={!cwd || loading}
                onClick={() => void load(parentPath)}
                className="rounded-sm px-1.5 py-0.5 hover:bg-hover-bg cursor-pointer disabled:opacity-40"
              >
                ..
              </button>
              <span className="truncate font-mono">{cwd || '.'}</span>
            </div>
            {error && (
              <p className="mx-4 mt-2 text-xs text-error-text">{error}</p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-text-tertiary" />
                </div>
              ) : entries.length === 0 ? (
                <p className="py-6 text-center text-xs text-text-tertiary">{t('actions.emptyFolder')}</p>
              ) : (
                <ul className="space-y-0.5">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.type === 'dir') {
                            if (dirsOnly) {
                              // double-purpose: click enters; Select button picks
                              void load(entry.path);
                            } else {
                              void load(entry.path);
                            }
                          } else {
                            onChange(entry.path);
                            setBrowseOpen(false);
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-hover-bg cursor-pointer"
                      >
                        {entry.type === 'dir' ? (
                          <FolderOpen size={14} className="shrink-0 text-text-tertiary" />
                        ) : (
                          <ChevronRight size={14} className="shrink-0 text-transparent" />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-text-primary">
                          {entry.name}
                        </span>
                        {entry.type === 'dir' && dirsOnly && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(entry.path);
                              setBrowseOpen(false);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange(entry.path);
                                setBrowseOpen(false);
                              }
                            }}
                            className="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] text-accent-primary hover:bg-accent-primary/10"
                          >
                            {t('actions.select')}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
