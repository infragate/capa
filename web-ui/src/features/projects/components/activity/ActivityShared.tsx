import { cn } from '../../../../lib/utils';
import { kindLabel } from './groupActivityRuns';

export function statusDotClass(status: string): string {
  if (status === 'running') return 'bg-accent-primary animate-pulse';
  if (status === 'ok') return 'bg-status-connected-dot';
  return 'bg-error-text';
}

export function sourceLabelText(
  source: string | null | undefined,
  t: (k: string) => string,
): string {
  if (source === 'shell') return t('activity.sourceShell');
  if (source === 'mcp') return t('activity.sourceMcp');
  if (source) return source;
  return t('activity.sourceUnknown');
}

/** Soft kind chip — muted, LangSmith-style. */
export function KindBadge({ kind, capa }: { kind: string; capa?: boolean }) {
  const label = kindLabel(kind);
  const tone = capa
    ? 'bg-info-bg text-info-text'
    : kind === 'prompt'
      ? 'bg-info-bg text-info-text'
      : kind === 'shell'
        ? 'bg-bg-tertiary text-text-secondary'
        : kind === 'file' || kind === 'read' || kind === 'write'
          ? 'bg-bg-tertiary text-text-secondary'
          : kind === 'error' || kind === 'stop'
            ? 'bg-error-bg text-error-text'
            : kind === 'session'
              ? 'bg-bg-tertiary text-text-tertiary'
              : 'bg-success-bg text-success-text';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5',
        'text-[10px] font-medium leading-none tracking-wide',
        tone,
      )}
    >
      {label}
    </span>
  );
}

export function LatencyBar({
  ms,
  maxMs,
  errored,
  capa,
}: {
  ms: number | null | undefined;
  maxMs: number;
  errored?: boolean;
  capa?: boolean;
}) {
  const pct =
    ms == null || maxMs <= 0 ? 0 : Math.min(100, Math.max(6, (ms / maxMs) * 100));
  return (
    <div className="hidden md:block h-1 w-14 shrink-0 overflow-hidden rounded-full bg-border-secondary">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 ease-out',
          errored
            ? 'bg-error-text/70'
            : capa
              ? 'bg-accent-primary/70'
              : 'bg-text-tertiary/60',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
