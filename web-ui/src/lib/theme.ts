export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'capa-theme';

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
}

export function initTheme(): Theme {
  const theme = getStoredTheme();
  setTheme(theme);
  return theme;
}
