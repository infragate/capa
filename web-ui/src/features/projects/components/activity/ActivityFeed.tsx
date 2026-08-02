import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import { PayloadBlock, formatArgsSummary } from './ActivityPayload';
import {
  type ActivityRun,
  formatDuration,
  formatRelative,
  groupActivityRuns,
  isCapaToolCall,
  kindLabel,
  maxSpanDuration,
} from './groupActivityRuns';

interface ActivityFeedProps {
  calls: ToolCallRecord[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

function statusDot(status: ToolCallRecord['status']): string {
  if (status === 'running') return 'bg-accent-primary animate-pulse';
  if (status === 'ok') return 'bg-status-connected-dot';
  return 'bg-error-text';
}

function sourceLabel(
  source: string | null | undefined,
  t: (k: string) => string,
): string {
  if (source === 'shell') return t('activity.sourceShell');
  if (source === 'mcp') return t('activity.sourceMcp');
  if (source) return source;
  return t('activity.sourceUnknown');
}

/** Soft kind chip — muted, LangSmith-style. */
function KindBadge({ kind, capa }: { kind: string; capa?: boolean }) {
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

function LatencyBar({
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

function SpanRow({
  call,
  maxMs,
  depth = 0,
}: {
  call: ToolCallRecord;
  maxMs: number;
  depth?: number;
}) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => formatArgsSummary(call.args_json), [call.args_json]);
  const capa = isCapaToolCall(call);

  return (
    <div className="group/span">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 py-1.5 pr-3 text-left cursor-pointer',
          'transition-colors duration-100',
          capa
            ? cn(
                'border-l-2 border-l-accent-primary bg-accent-primary/[0.04]',
                'hover:bg-accent-primary/[0.08]',
                open && 'bg-accent-primary/[0.1]',
              )
            : cn(
                'border-l-2 border-l-transparent hover:bg-hover-bg/70',
                open && 'bg-bg-tertiary/40',
              ),
        )}
        style={{ paddingLeft: `${10 + depth * 18}px` }}
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            className={cn('h-1.5 w-1.5 rounded-full', statusDot(call.status))}
            title={call.status}
          />
        </span>
        <KindBadge kind={call.kind} capa={capa} />
        {capa ? (
          <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-accent-primary">
            {t('activity.capaBadge')}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
          <span className={cn('font-medium', capa && 'text-accent-primary')}>
            {call.tool_name}
          </span>
          {summary ? (
            <span className="ml-2 font-normal text-text-tertiary" title={summary}>
              {summary}
            </span>
          ) : null}
        </span>
        <LatencyBar
          ms={call.duration_ms}
          maxMs={maxMs}
          errored={call.status === 'error'}
          capa={capa}
        />
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text-tertiary">
          {formatDuration(call.duration_ms)}
        </span>
      </button>

      {open && (
        <div
          className={cn(
            'border-y py-3',
            capa
              ? 'border-accent-primary/20 bg-accent-primary/[0.03]'
              : 'border-border-secondary/80 bg-bg-primary/50',
          )}
          style={{ paddingLeft: `${28 + depth * 18}px`, paddingRight: 12 }}
        >
          <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
            <span>{sourceLabel(call.source, t)}</span>
            <span className="tabular-nums">{formatRelative(call.started_at)}</span>
            {call.meta_tool && call.meta_tool !== call.tool_name ? (
              <span>via {call.meta_tool}</span>
            ) : null}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {call.args_json ? (
              <PayloadBlock label={t('activity.args')} text={call.args_json} />
            ) : (
              <div className="rounded-md border border-dashed border-border-secondary px-3 py-4 text-[11px] text-text-tertiary">
                {t('activity.noInput')}
              </div>
            )}
            {call.error_message ? (
              <PayloadBlock label={t('activity.error')} text={call.error_message} />
            ) : call.result_preview ? (
              <PayloadBlock
                label={t('activity.result')}
                text={call.result_preview}
                showSize
                originalBytes={call.result_bytes}
                originalTokens={call.result_tokens}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border-secondary px-3 py-4 text-[11px] text-text-tertiary">
                {t('activity.noOutput')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunGroup({
  run,
  maxMs,
  defaultOpen,
}: {
  run: ActivityRun;
  maxMs: number;
  defaultOpen: boolean;
}) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(defaultOpen);
  const spanCount = run.spans.length + (run.prompt ? 1 : 0);

  return (
    <div className="border-b border-border-secondary/90 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2.5 text-left cursor-pointer',
          'hover:bg-hover-bg/60 transition-colors duration-100',
          open && 'bg-bg-tertiary/30',
        )}
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-text-tertiary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
        )}
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            run.hasError ? 'bg-error-text' : 'bg-status-connected-dot',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
          {run.title}
        </span>
        <span className="hidden sm:inline shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
          {sourceLabel(run.source, t)}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
          {spanCount} {spanCount === 1 ? t('activity.span') : t('activity.spans')}
        </span>
        <LatencyBar ms={run.duration_ms} maxMs={maxMs} errored={run.hasError} />
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
          {formatDuration(run.duration_ms)}
        </span>
        <span className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-text-tertiary sm:block">
          {formatRelative(run.started_at)}
        </span>
      </button>

      {open && (
        <div className="relative pb-1">
          <div
            className="pointer-events-none absolute bottom-2 top-0 w-px bg-border-secondary"
            style={{ left: 20 }}
            aria-hidden
          />
          {run.prompt ? <SpanRow call={run.prompt} maxMs={maxMs} depth={1} /> : null}
          {run.spans.map((span) => (
            <SpanRow key={span.id} call={span} maxMs={maxMs} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityFeed({
  calls,
  hasMore,
  loadingMore,
  onLoadMore,
}: ActivityFeedProps) {
  const { t } = useTranslation('projects');
  const runs = useMemo(() => groupActivityRuns(calls), [calls]);
  const maxMs = useMemo(() => maxSpanDuration(runs), [runs]);

  if (calls.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-text-tertiary">
        {t('activity.empty')}
      </div>
    );
  }

  return (
    <div className="max-h-[560px] overflow-y-auto">
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-border-secondary bg-bg-secondary/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-text-tertiary backdrop-blur-sm">
        <span className="w-4 shrink-0" />
        <span className="min-w-0 flex-1">{t('activity.colName')}</span>
        <span className="hidden sm:inline w-16 shrink-0 text-right">{t('activity.colSource')}</span>
        <span className="w-14 shrink-0 text-right">{t('activity.colSpans')}</span>
        <span className="hidden md:inline w-14 shrink-0" />
        <span className="w-12 shrink-0 text-right">{t('activity.colLatency')}</span>
        <span className="hidden w-14 shrink-0 text-right sm:block">{t('activity.colTime')}</span>
      </div>
      {runs.map((run, i) => (
        <RunGroup key={run.id} run={run} maxMs={maxMs} defaultOpen={i === 0} />
      ))}
      {hasMore && (
        <div className="sticky bottom-0 border-t border-border-secondary bg-bg-secondary/95 px-3 py-2.5 text-center backdrop-blur-sm">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover-bg cursor-pointer disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={12} className="animate-spin" />}
            {t('activity.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
