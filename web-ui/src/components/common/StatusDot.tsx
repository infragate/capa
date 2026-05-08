import { cn } from '../../lib/utils';

interface StatusDotProps {
  connected: boolean;
  label: string;
  className?: string;
}

export function StatusDot({ connected, label, className }: StatusDotProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        connected ? 'text-status-connected' : 'text-text-secondary',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          connected ? 'bg-status-connected-dot' : 'bg-text-tertiary',
        )}
      />
      <span>{label}</span>
    </div>
  );
}
