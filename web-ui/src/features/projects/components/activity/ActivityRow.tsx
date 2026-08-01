import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, Copy, Check, Expand, X } from 'lucide-react';
import type { ToolCallRecord } from '../../../../types/api';
import { cn, formatTokenCount } from '../../../../lib/utils';
import { CodeBlock } from '../../../../components/common/CodeBlock';

interface ActivityRowProps {
  call: ToolCallRecord;
}

const PREVIEW_CHARS = 280;

function statusColor(status: ToolCallRecord['status']): string {
  if (status === 'running') return 'bg-accent-primary animate-pulse';
  if (status === 'ok') return 'bg-status-connected-dot';
  return 'bg-error-text';
}

function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** ~4 chars ≈ 1 token — same heuristic as token savings estimates. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatSizeKb(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 0.1) return `${bytes} B`;
  if (kb < 10) return `${kb.toFixed(2)} KB`;
  return `${kb.toFixed(1)} KB`;
}

function tryFormatJson(text: string): { formatted: string; isJson: boolean } {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[' && trimmed[0] !== '"')) {
    return { formatted: text, isJson: false };
  }
  try {
    const parsed = JSON.parse(trimmed);
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { formatted: text, isJson: false };
  }
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    const q = JSON.stringify(value);
    return q.length > 36 ? `${q.slice(0, 33)}…"` : q;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{…}';
  return String(value);
}

/** Compact one-line summary of args for the collapsed row header. */
function formatArgsSummary(argsJson: string | null, maxLen = 120): string | null {
  if (!argsJson?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed === null || typeof parsed !== 'object') {
      const s = String(parsed);
      return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
    }
    if (Array.isArray(parsed)) {
      const s = JSON.stringify(parsed);
      return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
    }
    const parts = Object.entries(parsed as Record<string, unknown>).map(
      ([k, v]) => `${k}=${formatArgValue(v)}`,
    );
    if (parts.length === 0) return null;
    let out = parts[0]!;
    for (let i = 1; i < parts.length; i++) {
      const next = `${out} ${parts[i]}`;
      if (next.length > maxLen) {
        out = `${out} …`;
        break;
      }
      out = next;
    }
    return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out;
  } catch {
    const s = argsJson.trim();
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  }
}

function PayloadBody({
  text,
  truncated,
}: {
  text: string;
  truncated?: boolean;
}) {
  const { formatted, isJson } = useMemo(() => tryFormatJson(text), [text]);
  const display = truncated && text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS)}…`
    : formatted;

  if (isJson && !truncated) {
    return (
      <CodeBlock
        code={formatted}
        language="json"
        className="!px-2 !py-2 text-[11px] leading-relaxed"
      />
    );
  }

  if (isJson && truncated) {
    // Keep the inline preview compact — full pretty JSON lives in the dialog.
    const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    return (
      <pre className="rounded-sm border border-border-tertiary bg-bg-primary p-2 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
        {preview}
      </pre>
    );
  }

  return (
    <pre className="rounded-sm border border-border-tertiary bg-bg-primary p-2 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
      {display}
    </pre>
  );
}

function PayloadBlock({
  label,
  text,
  showSize = false,
  originalBytes,
  originalTokens,
}: {
  label: string;
  text: string;
  showSize?: boolean;
  /** Prefers server-measured original size when available. */
  originalBytes?: number | null;
  originalTokens?: number | null;
}) {
  const { t } = useTranslation('projects');
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const byteLength = useMemo(() => {
    if (typeof originalBytes === 'number') return originalBytes;
    return new TextEncoder().encode(text).length;
  }, [originalBytes, text]);
  const tokens = useMemo(() => {
    if (typeof originalTokens === 'number') return originalTokens;
    return estimateTokens(text);
  }, [originalTokens, text]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
            {label}
          </span>
          {showSize && (
            <span className="text-[10px] text-text-tertiary tabular-nums">
              {formatSizeKb(byteLength)} · ~{formatTokenCount(tokens)}{' '}
              {t('activity.tokens')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-bg-secondary hover:text-text-secondary cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setDialogOpen(true);
            }}
          >
            <Expand size={10} />
            {t('activity.viewFull')}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-bg-secondary hover:text-text-secondary cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <PayloadBody text={text} truncated />

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            className="ui-dialog fixed z-50 flex max-h-[min(90vh,720px)] w-[min(720px,94vw)] flex-col rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="text-sm font-medium text-text-primary">
                  {label}
                </Dialog.Title>
                {showSize && (
                  <p className="mt-0.5 text-[10px] text-text-tertiary tabular-nums">
                    {formatSizeKb(byteLength)} · ~{formatTokenCount(tokens)}{' '}
                    {t('activity.tokens')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-tertiary hover:bg-hover-bg hover:text-text-secondary cursor-pointer"
                  onClick={() => {
                    void navigator.clipboard.writeText(text);
                  }}
                >
                  <Copy size={12} />
                  Copy
                </button>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </Dialog.Close>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-border-tertiary bg-bg-primary">
              <PayloadBody text={text} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function ActivityRow({ call }: ActivityRowProps) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);

  const sourceLabel =
    call.source === 'shell'
      ? t('activity.sourceShell')
      : call.source && call.source !== 'mcp'
        ? call.source
        : t('activity.sourceMcp');

  const argsSummary = useMemo(() => formatArgsSummary(call.args_json), [call.args_json]);

  return (
    <div className="border-b border-border-tertiary last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-tertiary/60 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-text-tertiary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
        )}
        <span
          className={cn('inline-block h-2 w-2 shrink-0 rounded-full', statusColor(call.status))}
          title={call.status}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
          <span className="font-medium">{call.tool_name}</span>
          {call.meta_tool && call.meta_tool !== call.tool_name ? (
            <span className="ml-1.5 text-text-tertiary">via {call.meta_tool}</span>
          ) : null}
          {argsSummary ? (
            <span className="ml-2 font-normal text-text-tertiary" title={argsSummary}>
              {argsSummary}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-sm border border-border-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
          {sourceLabel}
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-text-tertiary w-14 text-right">
          {call.duration_ms != null ? `${call.duration_ms}ms` : '…'}
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-text-tertiary w-16 text-right">
          {formatRelative(call.started_at)}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border-tertiary bg-bg-secondary/40 px-3 py-3">
          <div className="flex flex-wrap gap-3 text-[10px] text-text-tertiary">
            <span>
              {t('activity.timestamp')}:{' '}
              <span className="text-text-secondary tabular-nums">
                {formatAbsolute(call.started_at)}
              </span>
            </span>
            <span>
              {t('activity.status')}: <span className="text-text-secondary">{call.status}</span>
            </span>
            <span>
              {t('activity.kind')}: <span className="text-text-secondary">{call.kind}</span>
            </span>
            {call.session_id && (
              <span className="font-mono truncate max-w-[12rem]" title={call.session_id}>
                {t('activity.session')}: {call.session_id}
              </span>
            )}
            {call.agent_id && (
              <span>
                {t('activity.agent')}:{' '}
                <span className="text-text-secondary">{call.agent_id}</span>
              </span>
            )}
          </div>
          {call.args_json && <PayloadBlock label={t('activity.args')} text={call.args_json} />}
          {call.result_preview && (
            <PayloadBlock
              label={t('activity.result')}
              text={call.result_preview}
              showSize
              originalBytes={call.result_bytes}
              originalTokens={call.result_tokens}
            />
          )}
          {call.error_message && (
            <PayloadBlock label={t('activity.error')} text={call.error_message} />
          )}
        </div>
      )}
    </div>
  );
}
