import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, FilePenLine, Search, Trash2 } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { FileTree } from '../../../../components/common/FileTree';
import {
  collectRunFileChanges,
  runFilesForFileTreeFiltered,
} from './buildRunFileTree';

interface ActivityRunFileTreeProps {
  events: ToolCallRecord[];
  runId: string;
  projectPath: string | null;
  selectedPathKeys: ReadonlySet<string>;
  scrollPathKey?: string | null;
  onFileSelect?: (pathKey: string) => void;
}

export function ActivityRunFileTree({
  events,
  runId,
  projectPath,
  selectedPathKeys,
  scrollPathKey = null,
  onFileSelect,
}: ActivityRunFileTreeProps) {
  const { t } = useTranslation('projects');
  const [search, setSearch] = useState('');
  const [treeExpansion, setTreeExpansion] = useState<'all' | 'none'>('all');

  useEffect(() => {
    setSearch('');
    setTreeExpansion('all');
  }, [runId]);

  const entries = useMemo(
    () => collectRunFileChanges(events, { realProjectPath: projectPath }),
    [events, projectPath],
  );

  const { files, annotations, directoryPathKeys, fileCount } = useMemo(() => {
    const filtered = runFilesForFileTreeFiltered(entries, search, {
      realProjectPath: projectPath,
    });
    return {
      files: filtered.files,
      annotations: filtered.annotations,
      directoryPathKeys: filtered.directoryPathKeys,
      fileCount: entries.length,
    };
  }, [entries, search, projectPath]);

  return (
    <aside
      className="flex min-h-0 h-full flex-col bg-bg-tertiary/30"
      aria-label={t('activity.runFiles.aria')}
    >
      <div className="shrink-0 space-y-2 border-b border-border-secondary px-3 py-2">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            {t('activity.runFiles.heading')}
          </h3>
          <p className="mt-0.5 text-[10px] leading-snug text-text-tertiary">
            {fileCount === 0
              ? t('activity.runFiles.empty')
              : t('activity.runFiles.count', { count: fileCount })}
          </p>
        </div>
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('activity.runFiles.searchPlaceholder')}
            className="w-full rounded-md border border-border-secondary bg-bg-secondary py-1.5 pl-7 pr-2 text-[11px] text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/50 focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTreeExpansion('all')}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-hover-bg"
          >
            {t('activity.runFiles.expandAll')}
          </button>
          <button
            type="button"
            onClick={() => setTreeExpansion('none')}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-hover-bg"
          >
            {t('activity.runFiles.collapseAll')}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {fileCount === 0 ? (
          <p className="px-1 text-[10px] text-text-tertiary">
            {t('activity.runFiles.emptyHint')}
          </p>
        ) : files.length === 0 ? (
          <p className="px-1 text-[10px] text-text-tertiary">
            {t('activity.runFiles.noSearchResults')}
          </p>
        ) : (
          <FileTree
            key={runId}
            files={files}
            annotations={annotations}
            variant="plain"
            defaultExpanded
            treeExpansion={treeExpansion}
            selectedPathKeys={selectedPathKeys}
            searchQuery={search}
            onFileSelect={onFileSelect}
            directoryPathKeys={directoryPathKeys}
            scrollPathKey={scrollPathKey}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-border-secondary px-3 py-2 text-[9px] text-text-tertiary">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <Eye size={10} className="text-accent-primary" />
            {t('activity.runFiles.read')}
          </span>
          <span className="inline-flex items-center gap-1">
            <FilePenLine size={10} className="text-amber-600 dark:text-amber-400" />
            {t('activity.runFiles.modified')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Trash2 size={10} className="text-error-text" />
            {t('activity.runFiles.deleted')}
          </span>
        </div>
      </div>
    </aside>
  );
}
