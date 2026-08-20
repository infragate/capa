import { Plus, Trash2 } from 'lucide-react';

export type SecretSourceKind = 'literal' | 'fromEnv' | 'fromCommand' | 'fromFile';

export type SecretValuePair = {
  key: string;
  source: SecretSourceKind;
  value: string;
};

export type SecretValue =
  | string
  | { fromEnv: string }
  | { fromCommand: string }
  | { fromFile: string };

export function secretValueToPair(
  key: string,
  value: SecretValue | null | undefined,
): SecretValuePair {
  if (value == null) return { key, source: 'literal', value: '' };
  if (typeof value === 'string') return { key, source: 'literal', value };
  if ('fromEnv' in value) return { key, source: 'fromEnv', value: value.fromEnv };
  if ('fromCommand' in value) {
    return { key, source: 'fromCommand', value: value.fromCommand };
  }
  return { key, source: 'fromFile', value: value.fromFile };
}

export function recordToSecretPairs(
  record: Record<string, SecretValue> | null | undefined,
): SecretValuePair[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => secretValueToPair(key, value));
}

export function secretPairsToRecord(
  pairs: SecretValuePair[],
): Record<string, SecretValue> | undefined {
  const out: Record<string, SecretValue> = {};
  for (const p of pairs) {
    const k = p.key.trim();
    if (!k) continue;
    const v = p.value;
    if (p.source === 'literal') {
      out[k] = v;
    } else if (p.source === 'fromEnv') {
      out[k] = { fromEnv: v };
    } else if (p.source === 'fromCommand') {
      out[k] = { fromCommand: v };
    } else {
      out[k] = { fromFile: v };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const SOURCE_OPTIONS: Array<{ value: SecretSourceKind; labelKey: string }> = [
  { value: 'literal', labelKey: 'actions.secretSourceLiteral' },
  { value: 'fromEnv', labelKey: 'actions.secretSourceFromEnv' },
  { value: 'fromCommand', labelKey: 'actions.secretSourceFromCommand' },
  { value: 'fromFile', labelKey: 'actions.secretSourceFromFile' },
];

function placeholderFor(source: SecretSourceKind, t: (key: string) => string): string {
  switch (source) {
    case 'fromEnv':
      return t('actions.secretValueEnvPlaceholder');
    case 'fromCommand':
      return t('actions.secretValueCommandPlaceholder');
    case 'fromFile':
      return t('actions.secretValueFilePlaceholder');
    default:
      return t('actions.secretValueLiteralPlaceholder');
  }
}

export function SecretValueEditor({
  pairs,
  onChange,
  keyLabel,
  addLabel,
  t,
}: {
  pairs: SecretValuePair[];
  onChange: (next: SecretValuePair[]) => void;
  keyLabel: string;
  addLabel: string;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-2">
      {pairs.map((pair, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
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
          <select
            value={pair.source}
            onChange={(e) => {
              const next = pairs.slice();
              next[i] = {
                ...pair,
                source: e.target.value as SecretSourceKind,
              };
              onChange(next);
            }}
            className="rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 text-xs text-text-primary"
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
          <input
            value={pair.value}
            placeholder={placeholderFor(pair.source, t)}
            onChange={(e) => {
              const next = pairs.slice();
              next[i] = { ...pair, value: e.target.value };
              onChange(next);
            }}
            className="min-w-0 flex-[1.6] rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
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
        onClick={() =>
          onChange([...pairs, { key: '', source: 'literal', value: '' }])
        }
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-secondary hover:bg-hover-bg hover:text-text-primary cursor-pointer"
      >
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  );
}
