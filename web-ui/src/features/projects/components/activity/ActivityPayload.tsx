import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Check, Expand, X } from 'lucide-react';
import { cn, formatTokenCount } from '../../../../lib/utils';
import { CodeBlock } from '../../../../components/common/CodeBlock';

const PREVIEW_CHARS = 280;

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

function PayloadBody({
  text,
  truncated,
}: {
  text: string;
  truncated?: boolean;
}) {
  const { formatted, isJson } = useMemo(() => tryFormatJson(text), [text]);
  const display =
    truncated && text.length > PREVIEW_CHARS
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
    const preview =
      text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    return (
      <pre className="max-h-40 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
        {preview}
      </pre>
    );
  }

  return (
    <pre className="max-h-40 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
      {display}
    </pre>
  );
}

export function PayloadBlock({
  label,
  text,
  showSize = false,
  originalBytes,
  originalTokens,
  /** Raise z-index when opened from inside another dialog. */
  nested = false,
}: {
  label: string;
  text: string;
  showSize?: boolean;
  originalBytes?: number | null;
  originalTokens?: number | null;
  nested?: boolean;
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

  const overlayZ = nested ? 'z-[60]' : 'z-40';
  const contentZ = nested ? 'z-[70]' : 'z-50';

  return (
    <div className="overflow-hidden rounded-md border border-border-secondary bg-bg-secondary">
      <div className="flex items-center justify-between gap-2 border-b border-border-secondary bg-bg-tertiary/50 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            {label}
          </span>
          {showSize && (
            <span className="text-[10px] text-text-tertiary tabular-nums">
              {formatSizeKb(byteLength)} · ~{formatTokenCount(tokens)}{' '}
              {t('activity.tokens')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
              'text-text-tertiary hover:bg-bg-secondary hover:text-text-secondary cursor-pointer',
            )}
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
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
              'text-text-tertiary hover:bg-bg-secondary hover:text-text-secondary cursor-pointer',
            )}
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

      <div className="px-1 py-1">
        <PayloadBody text={text} truncated />
      </div>

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn('ui-overlay fixed inset-0 bg-black/40', overlayZ)}
          />
          <Dialog.Content
            className={cn(
              'ui-dialog fixed flex max-h-[min(90vh,720px)] w-[min(720px,94vw)] flex-col rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg',
              contentZ,
            )}
            onClick={(e) => e.stopPropagation()}
            onOpenAutoFocus={(e) => e.preventDefault()}
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
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-text-tertiary hover:bg-hover-bg hover:text-text-secondary cursor-pointer"
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
                    className="rounded-md p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </Dialog.Close>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-tertiary bg-bg-primary">
              <PayloadBody text={text} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function formatArgsSummary(argsJson: string | null, maxLen = 100): string | null {
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
    const entries = Object.entries(parsed as Record<string, unknown>);
    // Prefer common “content” keys for a scannable preview.
    const preferred = ['command', 'path', 'file_path', 'query', 'prompt', 'name'];
    for (const key of preferred) {
      const hit = entries.find(([k]) => k === key);
      if (hit && typeof hit[1] === 'string') {
        const v = hit[1];
        return v.length > maxLen ? `${v.slice(0, maxLen - 1)}…` : v;
      }
    }
    const parts = entries.map(([k, v]) => {
      if (typeof v === 'string') {
        const q = JSON.stringify(v);
        return `${k}=${q.length > 28 ? `${q.slice(0, 25)}…"` : q}`;
      }
      if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${v}`;
      return `${k}=…`;
    });
    let out = parts[0] ?? '';
    for (let i = 1; i < parts.length; i++) {
      const next = `${out} ${parts[i]}`;
      if (next.length > maxLen) {
        out = `${out} …`;
        break;
      }
      out = next;
    }
    return out || null;
  } catch {
    const s = argsJson.trim();
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  }
}
