import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function SearchInput({ placeholder, value, onChange, debounceMs = 120 }: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleChange = useCallback(
    (v: string) => {
      setLocalValue(v);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(v.trim()), debounceMs);
    },
    [onChange, debounceMs],
  );

  const clear = useCallback(() => {
    setLocalValue('');
    onChange('');
  }, [onChange]);

  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && clear()}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border-primary bg-input-bg py-2 pl-9 pr-8 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
        autoComplete="off"
      />
      {localValue && (
        <button
          onClick={clear}
          className="absolute right-2 flex items-center justify-center rounded-sm p-1 text-text-tertiary transition-colors hover:text-text-primary"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
