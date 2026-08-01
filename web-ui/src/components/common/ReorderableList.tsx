import { useEffect, useRef, useState, type ReactNode } from 'react';
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

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function autoScrollDuringDrag(clientY: number, fromEl: HTMLElement | null) {
  const scroller = findScrollParent(fromEl);
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 48;
  const step = 18;
  if (clientY < rect.top + edge) scroller.scrollTop -= step;
  else if (clientY > rect.bottom - edge) scroller.scrollTop += step;
}

function ReorderHandle({
  disabled,
  label,
  onArm,
}: {
  disabled?: boolean;
  label: string;
  onArm: () => void;
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
        if (!disabled) onArm();
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
        if (!disabled) onArm();
      }}
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
  /** When true, the item cannot be dragged (e.g. plugin-sourced). */
  isLocked?: (item: T) => boolean;
  onReorder: (orderedIds: string[]) => void;
  className?: string;
  handleLabel: string;
  renderItem: (
    item: T,
    ctx: {
      handle: ReactNode;
      isDragging: boolean;
      isOver: boolean;
      locked: boolean;
    },
  ) => ReactNode;
}

export function ReorderableList<T>({
  items,
  getId,
  disabled,
  isLocked,
  onReorder,
  className,
  handleLabel,
  renderItem,
}: ReorderableListProps<T>) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // HTML5 DnD fires dragOver before React re-renders after dragStart. Refs keep
  // preventDefault / commit logic correct on large lists where paint is slower.
  const armedIdRef = useRef<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const idsRef = useRef<string[]>([]);
  const droppedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const ids = items.map(getId);
  idsRef.current = ids;

  function setRowDraggable(id: string | null, value: boolean) {
    if (!id) return;
    const el = rowRefs.current.get(id);
    if (el) el.draggable = value;
  }

  function clearArm() {
    if (draggingIdRef.current) return;
    setRowDraggable(armedIdRef.current, false);
    armedIdRef.current = null;
    setArmedId(null);
  }

  useEffect(() => {
    const onUp = () => clearArm();
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  function armRow(id: string) {
    if (disabled) return;
    const item = items.find((entry) => getId(entry) === id);
    if (item && isLocked?.(item)) return;
    // Enable draggable synchronously so the next pointer move can start a drag
    // before React paints — critical on large tool lists.
    if (armedIdRef.current && armedIdRef.current !== id) {
      setRowDraggable(armedIdRef.current, false);
    }
    armedIdRef.current = id;
    setArmedId(id);
    setRowDraggable(id, true);
  }

  function setDragging(id: string | null) {
    draggingIdRef.current = id;
    setDraggingId(id);
  }

  function setOver(id: string | null) {
    overIdRef.current = id;
    setOverId(id);
  }

  function resetDrag() {
    setRowDraggable(draggingIdRef.current, false);
    setRowDraggable(armedIdRef.current, false);
    draggingIdRef.current = null;
    overIdRef.current = null;
    armedIdRef.current = null;
    droppedRef.current = false;
    setArmedId(null);
    setDraggingId(null);
    setOverId(null);
  }

  function commitReorder(active: string, over: string) {
    const next = moveItemIds(idsRef.current, active, over);
    if (next) onReorder(next);
  }

  return (
    <div ref={listRef} className={className}>
      {items.map((item) => {
        const id = getId(item);
        const locked = !!isLocked?.(item);
        const isDragging = draggingId === id;
        const isOver = overId === id && draggingId !== null && draggingId !== id;

        const handle = locked ? null : (
          <ReorderHandle
            disabled={disabled}
            label={handleLabel}
            onArm={() => armRow(id)}
          />
        );

        return (
          <div
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            draggable={!disabled && !locked && armedId === id}
            onDragStart={(e) => {
              if (disabled || locked || armedIdRef.current !== id) {
                e.preventDefault();
                return;
              }
              droppedRef.current = false;
              setDragging(id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragEnd={() => {
              // Drops often fail inside overflow scrollers; commit from last hover target.
              if (!droppedRef.current) {
                const active = draggingIdRef.current;
                const over = overIdRef.current;
                if (active && over && active !== over) {
                  commitReorder(active, over);
                }
              }
              resetDrag();
            }}
            onDragOver={(e) => {
              const active = draggingIdRef.current;
              if (!active || disabled) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overIdRef.current !== id) setOver(id);
              autoScrollDuringDrag(e.clientY, listRef.current);
            }}
            onDrop={(e) => {
              e.preventDefault();
              droppedRef.current = true;
              const active = draggingIdRef.current || e.dataTransfer.getData('text/plain');
              commitReorder(active, id);
              resetDrag();
            }}
            className={cn(
              isDragging && 'opacity-50',
              isOver && 'rounded-sm ring-1 ring-accent-primary',
            )}
          >
            {renderItem(item, { handle, isDragging, isOver, locked })}
          </div>
        );
      })}
    </div>
  );
}
