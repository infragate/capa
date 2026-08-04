import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../../lib/utils';

interface ActivityRunSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  className?: string;
}

export function ActivityRunSplitPane({
  left,
  right,
  defaultLeftWidth = 280,
  minLeftWidth = 200,
  maxLeftWidth = 560,
  className,
}: ActivityRunSplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(defaultLeftWidth);

  const clampWidth = useCallback(
    (width: number) => Math.min(maxLeftWidth, Math.max(minLeftWidth, width)),
    [maxLeftWidth, minLeftWidth],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      setLeftWidth(clampWidth(startWidthRef.current + delta));
    },
    [clampWidth],
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  function onHandlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }

  function nudgeWidth(delta: number) {
    setLeftWidth((w) => clampWidth(w + delta));
  }

  useEffect(() => () => endDrag(), [endDrag]);

  return (
    <div className={cn('flex min-h-0 flex-1 overflow-hidden', className)}>
      <div
        className="flex min-h-0 shrink-0 flex-col overflow-hidden"
        style={{ width: leftWidth }}
      >
        {left}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={minLeftWidth}
        aria-valuemax={maxLeftWidth}
        aria-valuenow={leftWidth}
        aria-label="Resize panels"
        onPointerDown={onHandlePointerDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            nudgeWidth(-16);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            nudgeWidth(16);
          }
        }}
        className={cn(
          'w-1 shrink-0 cursor-col-resize bg-border-secondary outline-none',
          'hover:bg-accent-primary/40 active:bg-accent-primary/55',
          'focus-visible:ring-2 focus-visible:ring-accent-primary/50',
          'transition-colors',
        )}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
