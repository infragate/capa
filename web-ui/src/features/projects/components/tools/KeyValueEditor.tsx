import { Plus, Trash2 } from 'lucide-react';

export function KeyValueEditor({
  pairs,
  onChange,
  keyLabel,
  valueLabel,
  addLabel,
}: {
  pairs: Array<{ key: string; value: string }>;
  onChange: (next: Array<{ key: string; value: string }>) => void;
  keyLabel: string;
  valueLabel: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={pair.key}
            placeholder={keyLabel}
            onChange={(e) => {
              const next = pairs.slice();
              next[i] = { ...pair, key: e.target.value };
              onChange(next);
            }}
            className="min-w-0 flex-1 rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
          />
          <input
            value={pair.value}
            placeholder={valueLabel}
            onChange={(e) => {
              const next = pairs.slice();
              next[i] = { ...pair, value: e.target.value };
              onChange(next);
            }}
            className="min-w-0 flex-[1.4] rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
          />
          <button
            type="button"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            className="rounded-sm p-1.5 text-text-tertiary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-secondary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
      >
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  );
}
