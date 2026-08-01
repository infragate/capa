import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrichedTool } from '../../../../types/api';

export function DefaultsEditor({
  tool,
  busy,
  onSave,
}: {
  tool: EnrichedTool;
  busy: boolean;
  onSave: (defaults: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation('projects');
  const props = tool._inputSchema?.properties || {};
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [key, value] of Object.entries(tool.defaults || {})) {
      init[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return init;
  });

  const entries = Object.keys(props);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1 pb-1" onClick={(e) => e.stopPropagation()}>
      {entries.map((name) => (
        <label key={name} className="flex items-center gap-2 text-[11px]">
          <span className="w-24 shrink-0 truncate font-mono text-text-secondary" title={name}>
            {name}
          </span>
          <input
            value={draft[name] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
            className="min-w-0 flex-1 rounded-sm border border-border-secondary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary"
          />
        </label>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const defaults: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(draft)) {
            if (v.trim() === '') continue;
            try {
              defaults[k] = JSON.parse(v);
            } catch {
              defaults[k] = v;
            }
          }
          onSave(defaults);
        }}
        className="mt-1 rounded-sm border border-border-tertiary px-2 py-1 text-[11px] cursor-pointer hover:bg-hover-bg disabled:opacity-50"
      >
        {t('actions.saveDefaults')}
      </button>
    </div>
  );
}
