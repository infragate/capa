import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ActivityRunDialogSearchProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchActive: boolean;
  matchedCount: number;
  totalCount: number;
};

export function ActivityRunDialogSearch({
  search,
  onSearchChange,
  searchActive,
  matchedCount,
  totalCount,
}: ActivityRunDialogSearchProps) {
  const { t } = useTranslation('projects');

  return (
    <div className="shrink-0 border-b border-border-secondary px-5 py-2.5">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('activity.runSearchPlaceholder')}
          className="w-full rounded-md border border-border-secondary bg-bg-secondary py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/50 focus:outline-none"
        />
      </div>
      {searchActive ? (
        <p className="mt-1.5 text-[11px] text-text-tertiary">
          {matchedCount === 0
            ? t('activity.runSearchNoResults')
            : t('activity.searchMatchCount', {
                matched: matchedCount,
                total: totalCount,
              })}
        </p>
      ) : null}
    </div>
  );
}
