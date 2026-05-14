import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchInput } from '../../../components/common/SearchInput';
import { Spinner } from '../../../components/common/Spinner';
import type { RegistryItemSummary } from '../api';

function safeStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.displayName === 'string') return o.displayName;
  }
  return String(v);
}

interface SearchPaneProps {
  query: string;
  onQueryChange: (q: string) => void;
  items: RegistryItemSummary[] | undefined;
  isLoading: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  capability: string;
  registryName: string;
}

export function SearchPane({
  query,
  onQueryChange,
  items,
  isLoading,
  selectedId,
  onSelect,
  capability,
  registryName,
}: SearchPaneProps) {
  const { t } = useTranslation('registries');
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const scrollSelectedIntoView = useCallback(() => {
    const container = listRef.current;
    const id = selectedIdRef.current;
    if (!container || !id) return;
    const el = container.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, []);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const ro = new ResizeObserver(scrollSelectedIntoView);
    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollSelectedIntoView]);

  useEffect(() => {
    scrollSelectedIntoView();
  }, [selectedId, scrollSelectedIntoView]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <SearchInput
          placeholder={t('search.placeholder', { capability })}
          value={query}
          onChange={onQueryChange}
          debounceMs={300}
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <Spinner label={t('search.loading')} />
        ) : !items || items.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-tertiary">
            {query
              ? t('search.noResultsForQuery', { query })
              : t('search.noResults')}
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id} data-item-id={item.id}>
                <button
                  onClick={() => onSelect(item.id)}
                  className={`w-full rounded-sm px-3 py-2.5 text-left transition-colors ${
                    selectedId === item.id
                      ? 'bg-accent-primary/10 text-text-primary'
                      : 'text-text-secondary hover:bg-hover-bg'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {item.icon && (
                      <img
                        src={item.icon}
                        alt=""
                        className="h-5 w-5 shrink-0 rounded-sm object-contain"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text-primary">{safeStr(item.title)}</span>
                        {item.version && (
                          <span className="shrink-0 rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                            {safeStr(item.version)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {item.description && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-text-tertiary">
                      {safeStr(item.description)}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-tertiary">
                    {item.author && <span>{safeStr(item.author)}</span>}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((tag, i) => (
                          <span
                            key={i}
                            className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-[10px]"
                          >
                            {safeStr(tag)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
