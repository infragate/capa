import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  loading = false,
  id,
  'aria-label': ariaLabel,
  className,
}: SwitchProps) {
  const inactive = disabled || loading;

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      disabled={inactive}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative box-border inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5',
        'transition-colors duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-bg-secondary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-status-connected' : 'bg-border-primary',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.22)]',
          'transition-transform duration-200 ease-out will-change-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
          loading && 'opacity-0',
        )}
      />
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={10} className="animate-spin text-white" />
        </span>
      ) : null}
    </button>
  );
}
