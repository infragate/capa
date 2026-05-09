import { useEffect, useRef, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

type AlertType = 'success' | 'error' | 'info';

interface AlertProps {
  type: AlertType;
  children: ReactNode;
  autoDismissMs?: number;
  onDismiss?: () => void;
}

const icons: Record<AlertType, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 flex-shrink-0" />,
  error: <XCircle className="h-4 w-4 flex-shrink-0" />,
  info: <Info className="h-4 w-4 flex-shrink-0" />,
};

const styles: Record<AlertType, string> = {
  success: 'bg-success-bg text-success-text border-success-border',
  error: 'bg-error-bg text-error-text border-error-border',
  info: 'bg-info-bg text-info-text border-info-border',
};

export function Alert({ type, children, autoDismissMs, onDismiss }: AlertProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (autoDismissMs && onDismiss) {
      timerRef.current = setTimeout(onDismiss, autoDismissMs);
      return () => clearTimeout(timerRef.current);
    }
  }, [autoDismissMs, onDismiss]);

  return (
    <div
      className={cn(
        'mb-5 flex items-center gap-3 rounded-sm border px-4 py-3 text-[13px]',
        styles[type],
      )}
    >
      {icons[type]}
      <span>{children}</span>
    </div>
  );
}
