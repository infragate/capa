import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { RegistryManifest } from '../api';

interface RegistryTabsProps {
  registries: RegistryManifest[];
  selected: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}

export function RegistryTabs({ registries, selected, onSelect, children }: RegistryTabsProps) {
  const { t } = useTranslation('registries');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [selected]);

  return (
    <div className="flex min-h-[calc(100vh-280px)] flex-col gap-4 lg:flex-row lg:gap-6">
      {/* Registry picker — horizontal scroll on small screens, vertical rail on lg+ */}
      <aside className="flex shrink-0 flex-col lg:w-56">
        <div className="mb-2 hidden px-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary lg:block">
          {t('registryList')}
        </div>
        <nav
          ref={listRef}
          aria-label={t('registryList')}
          className={cn(
            'flex gap-1',
            // Mobile: single-row horizontal scroller
            'overflow-x-auto border-b border-border-secondary pb-2',
            // Desktop: fixed-height vertical list that scrolls independently
            'lg:max-h-[calc(100vh-300px)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:border-r lg:border-border-secondary lg:pb-0 lg:pr-3',
          )}
        >
          {registries.map((r) => {
            const active = r.id === selected;
            return (
              <button
                key={r.id}
                type="button"
                data-active={active ? 'true' : undefined}
                onClick={() => onSelect(r.id)}
                title={r.description ? `${r.name} — ${r.description}` : r.name}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                  'max-w-[12rem] lg:max-w-none lg:w-full',
                  active
                    ? 'bg-accent-primary/10 text-text-primary'
                    : 'text-text-secondary hover:bg-hover-bg hover:text-text-primary',
                )}
              >
                {r.icon ? (
                  <img
                    src={r.icon}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm object-contain"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-bg-tertiary text-[9px] font-medium text-text-tertiary"
                  >
                    {(r.name[0] ?? '?').toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 truncate">{r.name}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
