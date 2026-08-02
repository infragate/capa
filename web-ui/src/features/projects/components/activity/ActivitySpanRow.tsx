import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCallRecord } from '../../../../types/api';
import { cn } from '../../../../lib/utils';
import { PayloadBlock, formatArgsSummary } from './ActivityPayload';
import {
  formatDuration,
  formatRelative,
  isCapaToolCall,
} from './groupActivityRuns';
import { KindBadge, LatencyBar, sourceLabelText, statusDotClass } from './ActivityShared';

interface ActivitySpanRowProps {
  call: ToolCallRecord;
  maxMs: number;
  /** Called when the user expands a span (e.g. to pause follow-latest). */
  onInspect?: () => void;
  /** Nested payload dialogs sit above the run dialog. */
  nestedPayload?: boolean;
}

export function ActivitySpanRow({
  call,
  maxMs,
  onInspect,
  nestedPayload = false,
}: ActivitySpanRowProps) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => formatArgsSummary(call.args_json), [call.args_json]);
  const capa = isCapaToolCall(call);

  return (
    <div className="group/span">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) onInspect?.();
            return next;
          });
        }}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-1.5 text-left cursor-pointer',
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
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(call.status))}
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
            'border-y px-3 py-3',
            capa
              ? 'border-accent-primary/20 bg-accent-primary/[0.03]'
              : 'border-border-secondary/80 bg-bg-primary/50',
          )}
        >
          <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
            <span>{sourceLabelText(call.source, t)}</span>
            <span className="tabular-nums">{formatRelative(call.started_at)}</span>
            {call.meta_tool && call.meta_tool !== call.tool_name ? (
              <span>via {call.meta_tool}</span>
            ) : null}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {call.args_json ? (
              <PayloadBlock
                label={t('activity.args')}
                text={call.args_json}
                nested={nestedPayload}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border-secondary px-3 py-4 text-[11px] text-text-tertiary">
                {t('activity.noInput')}
              </div>
            )}
            {call.error_message ? (
              <PayloadBlock
                label={t('activity.error')}
                text={call.error_message}
                nested={nestedPayload}
              />
            ) : call.result_preview ? (
              <PayloadBlock
                label={t('activity.result')}
                text={call.result_preview}
                showSize
                originalBytes={call.result_bytes}
                originalTokens={call.result_tokens}
                nested={nestedPayload}
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
