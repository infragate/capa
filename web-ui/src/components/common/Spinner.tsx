import { cn } from '../../lib/utils';

interface SpinnerProps {
  className?: string;
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16', className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-tertiary border-t-accent-primary" />
      {label && <div className="text-sm text-text-secondary">{label}</div>}
    </div>
  );
}
