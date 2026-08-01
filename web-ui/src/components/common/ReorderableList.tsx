import { useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils';

export function moveItemIds(
  ids: string[],
  activeId: string,
  overId: string,
): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function ReorderHandle({
  disabled,
  label,
  onArmedChange,
}: {
  disabled?: boolean;
  label: string;
  onArmedChange: (armed: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      data-reorder-handle
      className={cn(
        'shrink-0 self-center rounded-sm p-1 text-text-tertiary',
        disabled
          ? 'cursor-default opacity-40'
          : 'cursor-grab active:cursor-grabbing hover:bg-hover-bg hover:text-text-secondary',
      )}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!disabled) onArmedChange(true);
      }}
      onMouseUp={() => onArmedChange(false)}
      onMouseLeave={() => onArmedChange(false)}
      onTouchStart={(e) => {
        e.stopPropagation();
        if (!disabled) onArmedChange(true);
      }}
      onTouchEnd={() => onArmedChange(false)}
      onClick={(e) => e.preventDefault()}
    >
      <GripVertical size={14} />
    </button>
  );
}

interface ReorderableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  disabled?: boolean;
  onReorder: (orderedIds: string[]) => void;
  className?: string;
  handleLabel: string;
  renderItem: (
    item: T,
    ctx: {
      handle: ReactNode;
      isDragging: boolean;
      isOver: boolean;
    },
  ) => ReactNode;
}

export function ReorderableList<T>({
  items,
  getId,
  disabled,
  onReorder,
  className,
  handleLabel,
  renderItem,
}: ReorderableListProps<T>) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const ids = items.map(getId);

  return (
    <div className={className}>
      {items.map((item) => {
        const id = getId(item);
        const isDragging = draggingId === id;
        const isOver = overId === id && draggingId !== null && draggingId !== id;

        const handle = (
          <ReorderHandle
            disabled={disabled}
            label={handleLabel}
            onArmedChange={(armed) => setArmedId(armed ? id : null)}
          />
        );

        return (
          <div
            key={id}
            draggable={!disabled && armedId === id}
            onDragStart={(e) => {
              if (disabled || armedId !== id) {
                e.preventDefault();
                return;
              }
              setDraggingId(id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setOverId(null);
              setArmedId(null);
            }}
            onDragOver={(e) => {
              if (!draggingId || disabled) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overId !== id) setOverId(id);
            }}
            onDragLeave={() => {
              if (overId === id) setOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const active = draggingId || e.dataTransfer.getData('text/plain');
              const next = moveItemIds(ids, active, id);
              setDraggingId(null);
              setOverId(null);
              setArmedId(null);
              if (next) onReorder(next);
            }}
            className={cn(
              isDragging && 'opacity-50',
              isOver && 'rounded-sm ring-1 ring-accent-primary',
            )}
          >
            {renderItem(item, { handle, isDragging, isOver })}
          </div>
        );
      })}
    </div>
  );
}
