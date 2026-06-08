const STORAGE_KEY = 'yosuku_theme';

export type Theme = 'dark' | 'light';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme) || 'dark';
  } catch {
    return 'dark';
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  } catch { /* ignore */ }
}

export function initTheme(): Theme {
  const theme = getStoredTheme();
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  return theme;
}
