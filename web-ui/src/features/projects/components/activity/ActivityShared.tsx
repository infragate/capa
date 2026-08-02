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

/**
 * Gantt-style bar: segment position/width within the parent run timeline
 * so each span shows where it sits relative to the others.
 */
export function SpanTimelineBar({
  runStart,
  runEnd,
  startedAt,
  durationMs,
  running,
  errored,
  capa,
}: {
  runStart: number;
  runEnd: number;
  startedAt: number;
  durationMs: number | null | undefined;
  running?: boolean;
  errored?: boolean;
  capa?: boolean;
}) {
  const total = Math.max(runEnd - runStart, 1);
  const spanEnd =
    durationMs != null
      ? startedAt + durationMs
      : running
        ? Math.max(startedAt, Math.min(Date.now(), runEnd))
        : startedAt;
  const leftPct = Math.max(0, Math.min(100, ((startedAt - runStart) / total) * 100));
  const rawWidth = ((Math.max(spanEnd, startedAt) - startedAt) / total) * 100;
  // Keep a visible stub for instant spans; clamp so it never overflows the track.
  const widthPct = Math.max(rawWidth < 0.8 ? 0.8 : rawWidth, 0.8);
  const clampedWidth = Math.min(widthPct, 100 - leftPct);

  return (
    <div
      className="relative hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-border-secondary md:block"
      title={`${Math.round(leftPct)}% → ${Math.round(leftPct + clampedWidth)}% of run`}
    >
      <div
        className={cn(
          'absolute top-0 h-full rounded-full transition-[left,width] duration-300 ease-out',
          errored
            ? 'bg-error-text/75'
            : running
              ? 'bg-accent-primary/80'
              : capa
                ? 'bg-accent-primary/70'
                : 'bg-text-tertiary/65',
        )}
        style={{ left: `${leftPct}%`, width: `${clampedWidth}%` }}
      />
    </div>
  );
}
