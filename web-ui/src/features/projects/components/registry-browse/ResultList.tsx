import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Spinner } from '../../../../components/common/Spinner';
import { isRegistryItemInstalled, type ResultRow } from './types';

interface ResultListProps {
  searching: boolean;
  results: ResultRow[];
  selected: ResultRow | null;
  showRegistry: boolean;
  installedIds?: ReadonlySet<string>;
  onSelect: (item: ResultRow) => void;
}

export function ResultList({
  searching,
  results,
  selected,
  showRegistry,
  installedIds,
  onSelect,
}: ResultListProps) {
  const { t } = useTranslation('projects');

  return (
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
          const installed = installedIds
            ? isRegistryItemInstalled(item.id, installedIds)
            : false;
          return (
            <button
              key={`${item.registryId}:${item.id}`}
              type="button"
              onClick={() => onSelect(item)}
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
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-text-primary">
                  {item.title || item.id}
                </span>
                {installed && (
                  <Check
                    size={14}
                    className="shrink-0 text-success-text"
                    aria-label={t('actions.installed')}
                  />
                )}
              </div>
              {item.description && (
                <span className="mt-1 line-clamp-2 text-[11px] text-text-secondary">
                  {item.description}
                </span>
              )}
              {showRegistry && (
                <span className="mt-1 text-[10px] text-text-tertiary">{item.registryName}</span>
              )}
            </button>
          );
        })}
    </div>
  );
}
