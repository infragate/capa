import { useState, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Theme, initTheme, setTheme as applyTheme } from '../../lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState<Theme>(initTheme);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setThemeState(next);
  }, [theme]);

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 rounded-sm border border-border-primary bg-transparent px-3 py-2 text-[13px] text-text-secondary transition-colors hover:border-accent-primary hover:bg-hover-bg"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? (
        <Sun className="h-[18px] w-[18px]" />
      ) : (
        <Moon className="h-[18px] w-[18px]" />
      )}
      <span>{theme === 'dark' ? t('theme.light') : t('theme.dark')}</span>
    </button>
  );
}
