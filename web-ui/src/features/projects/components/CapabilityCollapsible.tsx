import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, Plus } from 'lucide-react';

interface CapabilityCollapsibleProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  /** When set, section is forced open (e.g. while searching). */
  forceOpen?: boolean;
  /**
   * Keep section body mounted even when collapsed (e.g. while an add dialog
   * that lives inside the body is open). Prefer false for performance.
   */
  keepMounted?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Extra status chips next to the count (e.g. Needs OAuth). */
  badges?: ReactNode;
  /** Rendered outside the collapsible body so dialogs work while collapsed. */
  dialog?: ReactNode;
}

export function CapabilityCollapsible({
  title,
  count,
  defaultOpen = false,
  forceOpen,
  keepMounted = false,
  onAdd,
  addLabel,
  children,
  actions,
  badges,
  dialog,
}: CapabilityCollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const effectiveOpen = forceOpen ? true : open;
  // Only mount heavy body content when visible or briefly needed for an in-body dialog
  const bodyMounted = effectiveOpen || keepMounted;

  return (
    <Collapsible.Root
      open={effectiveOpen}
      onOpenChange={(next) => {
        if (forceOpen) return;
        setOpen(next);
      }}
      className="border-b border-border-secondary last:border-0"
    >
      <div className="flex items-center gap-2 py-3">
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-text-primary cursor-pointer"
          >
            <ChevronDown
              size={16}
              className={`shrink-0 text-text-tertiary transition-transform ${effectiveOpen ? '' : '-rotate-90'}`}
            />
            <span>{title}</span>
            <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs font-normal text-text-secondary tabular-nums">
              {count}
            </span>
            {badges}
          </button>
        </Collapsible.Trigger>
        <div className="flex items-center gap-1">
          {actions}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              title={addLabel}
              aria-label={addLabel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary cursor-pointer"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>
      {bodyMounted && (
        <Collapsible.Content
          forceMount={keepMounted && !effectiveOpen}
          className={
            effectiveOpen
              ? 'overflow-hidden pb-4 data-[state=open]:animate-collapsible-down'
              : 'hidden'
          }
        >
          {children}
        </Collapsible.Content>
      )}
      {dialog}
    </Collapsible.Root>
  );
}
