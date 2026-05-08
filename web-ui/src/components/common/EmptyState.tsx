import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string | ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && <div className="mb-5 text-text-tertiary">{icon}</div>}
      <h2 className="mb-2 text-xl font-normal text-text-primary">{title}</h2>
      {description && (
        <div className="max-w-md text-sm text-text-secondary">{description}</div>
      )}
    </div>
  );
}
