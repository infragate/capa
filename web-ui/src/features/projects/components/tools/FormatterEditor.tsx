import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EnrichedTool } from '../../../../types/api';

export function FormatterEditor({
  tool,
  busy,
  onSave,
}: {
  tool: EnrichedTool;
  busy: boolean;
  onSave: (formatter: { cmd: string; timeout?: number } | null) => void;
}) {
  const { t } = useTranslation('projects');
  const [cmd, setCmd] = useState(tool.formatter?.cmd || '');
  const [timeoutMs, setTimeoutMs] = useState(
    tool.formatter?.timeout != null ? String(tool.formatter.timeout) : '',
  );

  useEffect(() => {
    setCmd(tool.formatter?.cmd || '');
    setTimeoutMs(tool.formatter?.timeout != null ? String(tool.formatter.timeout) : '');
  }, [tool.id, tool.formatter?.cmd, tool.formatter?.timeout]);

  return (
    <div
      className="space-y-2 pb-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className="block text-[11px] text-text-secondary">
        {t('actions.formatterCmd')}
        <input
          value={cmd}
          disabled={busy}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="jq -r '.[] | [.id, .name] | @tsv'"
          className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary disabled:opacity-50"
        />
        <span className="mt-0.5 block text-[10px] text-text-tertiary">{t('actions.formatterCmdHint')}</span>
      </label>
      <label className="block text-[11px] text-text-secondary">
        {t('actions.formatterTimeout')}
        <input
          type="number"
          min={1}
          value={timeoutMs}
          disabled={busy}
          onChange={(e) => setTimeoutMs(e.target.value)}
          placeholder="3000"
          className="mt-1 w-full rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary disabled:opacity-50"
        />
        <span className="mt-0.5 block text-[10px] text-text-tertiary">
          {t('actions.formatterTimeoutHint')}
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !cmd.trim()}
          onClick={() => {
            const parsed = timeoutMs.trim() ? Number(timeoutMs) : undefined;
            onSave({
              cmd: cmd.trim(),
              ...(parsed != null && Number.isFinite(parsed) && parsed > 0
                ? { timeout: Math.floor(parsed) }
                : {}),
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {t('actions.saveFormatter')}
        </button>
        {tool.formatter && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCmd('');
              setTimeoutMs('');
              onSave(null);
            }}
            className="rounded-sm px-2 py-1 text-[11px] text-text-tertiary hover:bg-hover-bg hover:text-text-secondary cursor-pointer disabled:opacity-50"
          >
            {t('actions.clearFormatter')}
          </button>
        )}
      </div>
    </div>
  );
}
