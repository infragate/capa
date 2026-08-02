import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  FileText,
  MessageSquare,
  Minimize2,
  Server,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  CircleDot,
} from 'lucide-react';
import { cn, formatTokenCount } from '../../../../lib/utils';
import type { ToolCallRecord } from '../../../../types/api';
import {
  hasTokenUsage,
  kindLabel,
  type RunTokenTotals,
} from './groupActivityRuns';

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

/** Icons aligned with CapabilitiesSection / plugin stats where possible. */
export function kindIcon(kind: string): LucideIcon {
  switch (kind) {
    case 'prompt':
      return MessageSquare;
    case 'shell':
      return Terminal;
    case 'file':
    case 'read':
    case 'write':
      return FileText;
    case 'skill':
      return Sparkles;
    case 'subagent':
      return Bot;
    case 'session':
      return CircleDot;
    case 'compact':
      return Minimize2;
    case 'stop':
      return Square;
    case 'agent_mcp':
      return Server;
    case 'setup_tools':
    case 'call_tool':
    case 'tool':
    case 'agent_tool':
      return Wrench;
    default:
      return Wrench;
  }
}

/** Soft kind chip — muted, LangSmith-style, with a type icon. */
export function KindBadge({ kind, capa }: { kind: string; capa?: boolean }) {
  const label = kindLabel(kind);
  const Icon = kindIcon(kind);
  const tone = capa
    ? 'bg-info-bg text-info-text'
    : kind === 'prompt'
      ? 'bg-info-bg text-info-text'
      : kind === 'shell'
        ? 'bg-bg-tertiary text-text-secondary'
        : kind === 'file' || kind === 'read' || kind === 'write'
          ? 'bg-bg-tertiary text-text-secondary'
          : kind === 'skill'
            ? 'bg-info-bg text-info-text'
            : kind === 'error' || kind === 'stop'
              ? 'bg-error-bg text-error-text'
              : kind === 'session'
                ? 'bg-bg-tertiary text-text-tertiary'
                : 'bg-success-bg text-success-text';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5',
        'text-[10px] font-medium leading-none tracking-wide',
        tone,
      )}
      title={label}
    >
      <Icon size={11} strokeWidth={2} className="shrink-0 opacity-90" aria-hidden />
      <span>{label}</span>
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

type TokenT = (key: string, opts?: Record<string, string | number>) => string;

/** Compact in/out · cache r/w chip for dialog header or span rows. */
export function TokenUsageLabel({
  totals,
  t,
  className,
}: {
  totals: RunTokenTotals | Pick<
    ToolCallRecord,
    'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'
  >;
  t: TokenT;
  className?: string;
}) {
  const normalized: RunTokenTotals =
    'hasAny' in totals
      ? totals
      : {
          input: totals.input_tokens ?? 0,
          output: totals.output_tokens ?? 0,
          cacheRead: totals.cache_read_tokens ?? 0,
          cacheWrite: totals.cache_write_tokens ?? 0,
          hasAny: hasTokenUsage(totals),
        };

  if (!normalized.hasAny) return null;

  const hasCache = normalized.cacheRead > 0 || normalized.cacheWrite > 0;
  const label = hasCache
    ? t('activity.tokenUsageWithCache', {
        in: formatTokenCount(normalized.input),
        out: formatTokenCount(normalized.output),
        cacheRead: formatTokenCount(normalized.cacheRead),
        cacheWrite: formatTokenCount(normalized.cacheWrite),
      })
    : t('activity.tokenUsage', {
        in: formatTokenCount(normalized.input),
        out: formatTokenCount(normalized.output),
      });

  return (
    <span
      className={cn('tabular-nums text-text-tertiary', className)}
      title={label}
    >
      {label}
    </span>
  );
}
