import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useRegistries } from '../../registries/hooks';
import { registriesApi, type RegistryItemDetail, type RegistryItemSummary } from '../../registries/api';
import { useAddFromRegistry, useAppendCapability } from '../hooks';
import { Spinner } from '../../../components/common/Spinner';
import { FileTree } from '../../../components/common/FileTree';
import { capaIdIssue, sanitizeCapaIdInput } from '../../../lib/ids';
import { LocalPathPicker } from './LocalPathPicker';

function capaIdErrorMessage(id: string, t: (key: string) => string): string | null {
  const issue = capaIdIssue(id);
  if (!issue) return null;
  if (issue === 'empty') return t('actions.idInvalidEmpty');
  if (issue === 'invalidStart') return t('actions.idInvalidStart');
  return t('actions.idInvalidChars');
}

const ALL = '__all__';

function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function renderMarkdown(md: string): string {
  const raw = marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

export interface RegistryBrowseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  capability: 'skills' | 'plugins';
  title: string;
  /** Skills also support creating an inline skill. */
  allowInline?: boolean;
  /** Skills also support creating a local (from file) skill. */
  allowLocal?: boolean;
}

type ResultRow = RegistryItemSummary & { registryId: string; registryName: string; registryIcon?: string };

export function RegistryBrowseDialog({
  open,
  onOpenChange,
  projectId,
  capability,
  title,
  allowInline = false,
  allowLocal = false,
}: RegistryBrowseDialogProps) {
  const { t } = useTranslation('projects');
  const { data: registries } = useRegistries();
  const addMutation = useAddFromRegistry(projectId);
  const appendMutation = useAppendCapability(projectId);

  const [mode, setMode] = useState<'registry' | 'inline' | 'local'>('registry');
  const [registryId, setRegistryId] = useState(ALL);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [selected, setSelected] = useState<ResultRow | null>(null);
  const [detail, setDetail] = useState<RegistryItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Inline skill fields
  const [inlineId, setInlineId] = useState('');
  const [inlineContent, setInlineContent] = useState('');
  // Local skill fields
  const [localId, setLocalId] = useState('');
  const [localPath, setLocalPath] = useState('');

  const busy = addMutation.isPending || appendMutation.isPending;

  /** Only registries whose manifest declares this capability (skills / plugins). */
  const compatibleRegistries = useMemo(
    () => (registries ?? []).filter((r) => r.capabilities?.includes(capability)),
    [registries, capability],
  );

  const selectedRegistry = useMemo(() => {
    if (registryId === ALL) return null;
    return compatibleRegistries.find((r) => r.id === registryId) ?? null;
  }, [compatibleRegistries, registryId]);

  useEffect(() => {
    if (!open) return;
    setMode('registry');
    setRegistryId(ALL);
    setQuery('');
    setResults([]);
    setSelected(null);
    setDetail(null);
    setError(null);
    setInlineId('');
    setInlineContent('');
    setLocalId('');
    setLocalPath('');
    setDropdownOpen(false);
  }, [open]);

  useEffect(() => {
    if (registryId === ALL) return;
    if (!compatibleRegistries.some((r) => r.id === registryId)) {
      setRegistryId(ALL);
    }
  }, [compatibleRegistries, registryId]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    registriesApi
      .view(selected.registryId, capability, selected.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, capability]);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      const targets =
        registryId === ALL
          ? compatibleRegistries
          : compatibleRegistries.filter((r) => r.id === registryId);
      if (targets.length === 0) {
        setResults([]);
        return;
      }
      setSearching(true);
      setError(null);
      setSelected(null);
      try {
        const batches = await Promise.all(
          targets.map(async (r) => {
            try {
              // Empty string yields initial/browse results from adapters.
              const res = await registriesApi.search(r.id, capability, searchQuery.trim(), 30);
              return res.items.map(
                (item): ResultRow => ({
                  ...item,
                  registryId: r.id,
                  registryName: r.name || r.id,
                  registryIcon: r.icon,
                }),
              );
            } catch {
              return [] as ResultRow[];
            }
          }),
        );
        setResults(batches.flat());
      } catch (err) {
        setError((err as Error).message);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [capability, compatibleRegistries, registryId],
  );

  // Load initial results with an empty query when the dialog opens / registry changes.
  useEffect(() => {
    if (!open || mode !== 'registry') return;
    if (compatibleRegistries.length === 0) return;
    void performSearch('');
  }, [open, mode, capability, registryId, compatibleRegistries, performSearch]);

  async function handleAdd() {
    if (!selected) return;
    setError(null);
    try {
      await addMutation.mutateAsync({
        section: capability,
        registry: selected.registryId,
        itemId: selected.id,
        capability,
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleInlineSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!inlineId.trim() || !inlineContent.trim()) {
      setError(t('actions.skillInlineRequired'));
      return;
    }
    const idErr = capaIdErrorMessage(inlineId, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    try {
      await appendMutation.mutateAsync({
        section: 'skills',
        entry: {
          id: inlineId.trim(),
          type: 'inline',
          def: { content: inlineContent.trim(), description: inlineId.trim() },
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleLocalSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!localId.trim() || !localPath.trim()) {
      setError(t('actions.skillLocalRequired'));
      return;
    }
    const idErr = capaIdErrorMessage(localId, t);
    if (idErr) {
      setError(idErr);
      return;
    }
    try {
      await appendMutation.mutateAsync({
        section: 'skills',
        entry: {
          id: localId.trim(),
          type: 'local',
          def: { path: localPath.trim() },
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const previewHtml = useMemo(
    () => (detail?.preview ? renderMarkdown(detail.preview) : ''),
    [detail?.preview],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="ui-dialog fixed z-50 flex h-[min(860px,92vh)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-xl">
          <div className="flex items-center justify-between border-b border-border-secondary px-5 py-3">
            <Dialog.Title className="text-base font-medium text-text-primary">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {(allowInline || allowLocal) && (
            <div className="flex flex-wrap gap-2 border-b border-border-secondary px-5 py-2">
              <button
                type="button"
                onClick={() => setMode('registry')}
                className={`rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  mode === 'registry'
                    ? 'bg-accent-primary/15 text-accent-primary'
                    : 'bg-bg-tertiary text-text-secondary'
                }`}
              >
                {t('actions.fromRegistry')}
              </button>
              {allowInline && (
                <button
                  type="button"
                  onClick={() => setMode('inline')}
                  className={`rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    mode === 'inline'
                      ? 'bg-accent-primary/15 text-accent-primary'
                      : 'bg-bg-tertiary text-text-secondary'
                  }`}
                >
                  {t('actions.createInline')}
                </button>
              )}
              {allowLocal && (
                <button
                  type="button"
                  onClick={() => setMode('local')}
                  className={`rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    mode === 'local'
                      ? 'bg-accent-primary/15 text-accent-primary'
                      : 'bg-bg-tertiary text-text-secondary'
                  }`}
                >
                  {t('actions.fromFile')}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mx-5 mt-3 rounded-sm border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
              {error}
            </div>
          )}

          {mode === 'local' && allowLocal ? (
            <form onSubmit={handleLocalSubmit} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
              <label className="block text-xs text-text-secondary">
                {t('actions.skillId')}
                <input
                  value={localId}
                  onChange={(e) => setLocalId(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
              </label>
              <div className="block text-xs text-text-secondary">
                {t('actions.skillLocalPath')}
                <div className="mt-1">
                  <LocalPathPicker
                    projectId={projectId}
                    value={localPath}
                    onChange={setLocalPath}
                    dirsOnly
                    uploadAsSkillDir
                    placeholder={t('actions.skillLocalPathHint')}
                  />
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary">{t('actions.skillLocalPathHint')}</p>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-fit items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t('actions.add')}
              </button>
            </form>
          ) : mode === 'inline' && allowInline ? (
            <form onSubmit={handleInlineSubmit} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
              <label className="block text-xs text-text-secondary">
                {t('actions.skillId')}
                <input
                  value={inlineId}
                  onChange={(e) => setInlineId(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
              </label>
              <label className="block min-h-0 flex-1 text-xs text-text-secondary">
                {t('actions.skillContent')}
                <textarea
                  value={inlineContent}
                  onChange={(e) => setInlineContent(e.target.value)}
                  className="mt-1 h-[min(420px,50vh)] w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-xs text-text-primary"
                  placeholder={'---\nname: my-skill\ndescription: ...\n---\n\n# Instructions'}
                />
              </label>
              <div>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {t('actions.add')}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((v) => !v)}
                    className="inline-flex min-w-[200px] items-center gap-2 rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary cursor-pointer hover:bg-hover-bg"
                  >
                    {registryId === ALL ? (
                      <span className="text-text-secondary">{t('actions.allRegistries')}</span>
                    ) : (
                      <>
                        {selectedRegistry?.icon && (
                          <img
                            src={selectedRegistry.icon}
                            alt=""
                            className="h-4 w-4 shrink-0 rounded-sm object-contain"
                          />
                        )}
                        <span className="truncate">{selectedRegistry?.name || registryId}</span>
                      </>
                    )}
                    <ChevronDown size={14} className="ml-auto shrink-0 text-text-tertiary" />
                  </button>
                  {dropdownOpen && (
                    <div className="ui-dropdown absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-sm border border-border-primary bg-bg-secondary py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setRegistryId(ALL);
                          setDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer hover:bg-hover-bg ${
                          registryId === ALL ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-primary'
                        }`}
                      >
                        {t('actions.allRegistries')}
                      </button>
                      {compatibleRegistries.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setRegistryId(r.id);
                            setDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer hover:bg-hover-bg ${
                            registryId === r.id ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-primary'
                          }`}
                        >
                          {r.icon ? (
                            <img src={r.icon} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
                          ) : (
                            <span className="inline-block h-4 w-4 shrink-0 rounded-sm bg-bg-tertiary" />
                          )}
                          <span className="truncate">{r.name || r.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
                    />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void performSearch(query);
                        }
                      }}
                      placeholder={
                        capability === 'skills' ? t('actions.searchSkills') : t('actions.searchPlugins')
                      }
                      className="w-full rounded-sm border border-border-tertiary bg-bg-tertiary py-2 pl-8 pr-2.5 text-sm text-text-primary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void performSearch(query)}
                    disabled={searching}
                    className="rounded-sm border border-border-tertiary px-3 py-2 text-xs cursor-pointer hover:bg-hover-bg disabled:opacity-50"
                  >
                    {searching ? <Loader2 size={14} className="animate-spin" /> : t('actions.search')}
                  </button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[340px_1fr]">
                <div className="min-h-0 overflow-y-auto rounded-sm border border-border-tertiary bg-bg-primary/30">
                  {searching && <Spinner className="py-8" />}
                  {!searching && results.length === 0 && (
                    <p className="px-3 py-8 text-center text-xs text-text-tertiary">
                      {t('actions.browseHint')}
                    </p>
                  )}
                  {!searching &&
                    results.map((item) => {
                      const active =
                        selected?.id === item.id && selected?.registryId === item.registryId;
                      return (
                        <button
                          key={`${item.registryId}:${item.id}`}
                          type="button"
                          onClick={() => setSelected(item)}
                          className={`flex w-full flex-col border-b border-border-secondary px-3 py-2.5 text-left cursor-pointer hover:bg-hover-bg ${
                            active ? 'bg-accent-primary/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {item.icon ? (
                              <img src={item.icon} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
                            ) : item.registryIcon ? (
                              <img
                                src={item.registryIcon}
                                alt=""
                                className="h-4 w-4 shrink-0 rounded-sm object-contain opacity-70"
                              />
                            ) : null}
                            <span className="truncate font-mono text-xs font-medium text-text-primary">
                              {item.title || item.id}
                            </span>
                          </div>
                          {item.description && (
                            <span className="mt-1 line-clamp-2 text-[11px] text-text-secondary">
                              {item.description}
                            </span>
                          )}
                          {registryId === ALL && (
                            <span className="mt-1 text-[10px] text-text-tertiary">{item.registryName}</span>
                          )}
                        </button>
                      );
                    })}
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-sm border border-border-tertiary bg-bg-primary/30">
                  {!selected && (
                    <p className="m-auto px-4 py-8 text-center text-xs text-text-tertiary">
                      {t('actions.selectItemPreview')}
                    </p>
                  )}
                  {selected && detailLoading && <Spinner className="py-12" />}
                  {selected && !detailLoading && detail && (
                    <>
                      <div className="flex items-start justify-between gap-3 border-b border-border-secondary px-4 py-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-mono text-sm font-medium text-text-primary">
                            {detail.title || detail.id}
                          </h3>
                          {detail.description && (
                            <p className="mt-1 text-xs text-text-secondary">{detail.description}</p>
                          )}
                          <p className="mt-1 text-[11px] text-text-tertiary">
                            {selected.registryName}
                            {detail.author ? ` · ${detail.author}` : ''}
                            {detail.version ? ` · ${detail.version}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleAdd()}
                          className="inline-flex shrink-0 items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
                        >
                          {busy && <Loader2 size={14} className="animate-spin" />}
                          {t('actions.add')}
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        {detail.files && detail.files.length > 0 && (
                          <div className="mb-4">
                            <h4 className="mb-2 text-xs font-medium text-text-primary">
                              {t('skillDetail.files')}
                            </h4>
                            <FileTree files={detail.files} />
                          </div>
                        )}
                        {previewHtml ? (
                          <div
                            className="registry-markdown overflow-hidden text-sm text-text-secondary"
                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                          />
                        ) : (
                          <p className="text-xs text-text-tertiary">{t('actions.noPreview')}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
