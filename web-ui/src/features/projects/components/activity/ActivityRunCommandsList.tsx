import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Search, Terminal } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import {
  collectRunCommands,
  filterRunCommands,
  runCommandsExportText,
} from './buildRunCommands';

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface ActivityRunCommandsListProps {
  events: ToolCallRecord[];
  runId: string;
  selectedSpanIds: ReadonlySet<string>;
  onCommandSelect?: (spanId: string) => void;
}

export function ActivityRunCommandsList({
  events,
  runId,
  selectedSpanIds,
  onCommandSelect,
}: ActivityRunCommandsListProps) {
  const { t } = useTranslation('projects');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setSearch('');
  }, [runId]);

  const entries = useMemo(() => collectRunCommands(events), [events]);
  const filtered = useMemo(
    () => filterRunCommands(entries, search),
    [entries, search],
  );

  function handleExport() {
    const text = runCommandsExportText(filtered.length > 0 || search ? filtered : entries);
    downloadTextFile(`run-${runId}-commands.txt`, text);
  }

  return (
    <aside
      className="flex min-h-0 h-full flex-col border-l border-border-secondary bg-bg-tertiary/20"
      aria-label={t('activity.runCommands.aria')}
    >
      <div className="shrink-0 space-y-2 border-b border-border-secondary px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              {t('activity.runCommands.heading')}
            </h3>
            <p className="mt-0.5 text-[10px] leading-snug text-text-tertiary">
              {entries.length === 0
                ? t('activity.runCommands.empty')
                : t('activity.runCommands.count', { count: entries.length })}
            </p>
          </div>
          {entries.length > 0 ? (
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-hover-bg"
              title={t('activity.runCommands.export')}
            >
              <Download size={11} />
              {t('activity.runCommands.export')}
            </button>
          ) : null}
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
            placeholder={t('activity.runCommands.searchPlaceholder')}
            className="w-full rounded-md border border-border-secondary bg-bg-secondary py-1.5 pl-7 pr-2 text-[11px] text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/50 focus:outline-none"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {entries.length === 0 ? (
          <p className="px-1 text-[10px] text-text-tertiary">
            {t('activity.runCommands.emptyHint')}
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-1 text-[10px] text-text-tertiary">
            {t('activity.runCommands.noSearchResults')}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((entry) => {
              const selected = selectedSpanIds.has(entry.id);
              return (
                <li key={entry.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onCommandSelect?.(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onCommandSelect?.(entry.id);
                      }
                    }}
                    className={cn(
                      'rounded-md border px-2 py-1.5 cursor-pointer transition-colors',
                      selected
                        ? 'border-accent-primary/40 bg-accent-primary/10 ring-1 ring-inset ring-accent-primary/25'
                        : 'border-border-secondary bg-bg-secondary hover:border-border-primary hover:bg-hover-bg/40',
                    )}
                  >
                    <div className="mb-1 flex items-center gap-1 text-[9px] text-text-tertiary">
                      <Terminal size={10} className="shrink-0" />
                      <span className="truncate font-mono">{entry.toolName}</span>
                    </div>
                    <pre className="select-text whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-text-primary">
                      {entry.command}
                    </pre>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
