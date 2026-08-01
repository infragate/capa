import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const prevTops = useRef(new Map<string, number>());

  const baseIds = useMemo(() => items.map(getId), [items, getId]);
  const itemById = useMemo(() => {
    const map = new Map<string, T>();
    for (const item of items) map.set(getId(item), item);
    return map;
  }, [items, getId]);

  const orderIds = previewIds ?? baseIds;
  const displayItems = orderIds
    .map((id) => itemById.get(id))
    .filter((item): item is T => item != null);

  // FLIP: when preview order changes, animate non-dragged rows into their new slots.
  const orderKey = orderIds.join('\0');
  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();
    for (const [id, el] of rowRefs.current) {
      nextTops.set(id, el.getBoundingClientRect().top);
    }

    if (draggingId) {
      for (const [id, el] of rowRefs.current) {
        if (id === draggingId) {
          el.style.transition = '';
          el.style.transform = '';
          continue;
        }
        const prev = prevTops.current.get(id);
        const next = nextTops.get(id);
        if (prev == null || next == null) continue;
        const dy = prev - next;
        if (Math.abs(dy) < 1) continue;
        el.style.transition = 'transform 0s';
        el.style.transform = `translateY(${dy}px)`;
        // Force reflow, then ease to the resting position.
        void el.offsetHeight;
        el.style.transition = 'transform 160ms ease';
        el.style.transform = '';
      }
    } else {
      for (const el of rowRefs.current.values()) {
        el.style.transition = '';
        el.style.transform = '';
      }
    }

    prevTops.current = nextTops;
  }, [orderKey, draggingId]);

  function resetDrag() {
    setDraggingId(null);
    setPreviewIds(null);
    setArmedId(null);
  }

  return (
    <div className={className}>
      {displayItems.map((item) => {
        const id = getId(item);
        const isDragging = draggingId === id;
        const baseIndex = baseIds.indexOf(id);
        const previewIndex = orderIds.indexOf(id);
        const isOver = !!draggingId && id !== draggingId && previewIndex !== baseIndex;

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
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            draggable={!disabled && armedId === id}
            onDragStart={(e) => {
              if (disabled || armedId !== id) {
                e.preventDefault();
                return;
              }
              setDraggingId(id);
              setPreviewIds([...baseIds]);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragEnd={() => {
              resetDrag();
            }}
            onDragOver={(e) => {
              if (!draggingId || !previewIds || disabled) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';

              const dragIndex = previewIds.indexOf(draggingId);
              const overIndex = previewIds.indexOf(id);
              if (dragIndex < 0 || overIndex < 0 || dragIndex === overIndex) return;

              // Only swap once the pointer crosses the row midpoint — avoids oscillation
              // when the DOM reorders under the cursor.
              const rect = e.currentTarget.getBoundingClientRect();
              const midY = rect.top + rect.height / 2;
              if (dragIndex < overIndex && e.clientY < midY) return;
              if (dragIndex > overIndex && e.clientY > midY) return;

              const next = moveItemIds(previewIds, draggingId, id);
              if (next) setPreviewIds(next);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const active = draggingId || e.dataTransfer.getData('text/plain');
              const next =
                (previewIds && active === draggingId ? previewIds : null) ||
                moveItemIds(baseIds, active, id);
              resetDrag();
              if (
                next &&
                (next.length !== baseIds.length || next.some((v, i) => v !== baseIds[i]))
              ) {
                onReorder(next);
              }
            }}
            className={cn(
              isDragging && 'relative z-10 opacity-50',
              isOver && 'rounded-sm',
            )}
          >
            {renderItem(item, { handle, isDragging, isOver })}
          </div>
        );
      })}
    </div>
  );
}
