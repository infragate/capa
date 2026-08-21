import { cn } from '../../../../lib/utils';

export type ActivityRunRightView = 'timeline' | 'process';

interface ActivityRunViewTabsProps {
  value: ActivityRunRightView;
  onChange: (view: ActivityRunRightView) => void;
  tracesLabel: string;
  processLabel: string;
}

export function ActivityRunViewTabs({
  value,
  onChange,
  tracesLabel,
  processLabel,
}: ActivityRunViewTabsProps) {
  return (
    <div
      className="relative inline-grid shrink-0 grid-cols-2 rounded-[10px] bg-bg-tertiary p-0.5"
      role="tablist"
      aria-label={tracesLabel}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[8px] bg-bg-secondary shadow-sm',
          'transition-transform duration-200 ease-out',
          value === 'process' && 'translate-x-full',
        )}
      />
      <button
        type="button"
        role="tab"
        aria-selected={value === 'timeline'}
        onClick={() => onChange('timeline')}
        className={cn(
          'relative z-[1] whitespace-nowrap rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium cursor-pointer transition-colors',
          value === 'timeline' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
        )}
      >
        {tracesLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'process'}
        onClick={() => onChange('process')}
        className={cn(
          'relative z-[1] whitespace-nowrap rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium cursor-pointer transition-colors',
          value === 'process' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
        )}
      >
        {processLabel}
      </button>
    </div>
  );
}
