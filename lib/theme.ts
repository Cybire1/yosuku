// Theme: dark (default) + a cream light mode drawn from the brand films
// (#F4EEE3 paper / #141210 ink / #D93E1F vermilion / #2E6B4F matcha).
// Persisted per-browser; first visit with no stored choice follows the OS.
const STORAGE_KEY = 'yosuku_theme';

export type Theme = 'dark' | 'light';

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function osPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** Stored choice wins; else follow the OS; else dark. */
export function resolveTheme(): Theme {
  return getStoredTheme() ?? (osPrefersLight() ? 'light' : 'dark');
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch { /* ignore */ }
  apply(theme);
}

export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setStoredTheme(next);
  return next;
}

/** Idempotent: set the attribute from the resolved theme, return it. */
export function initTheme(): Theme {
  const theme = resolveTheme();
  apply(theme);
  return theme;
}

// Blocking snippet injected into <head> so the correct theme paints on the
// FIRST frame — no flash of dark before hydration. Kept tiny + dependency-free;
// mirrors resolveTheme() above (stored → OS → dark).
export const THEME_INIT_SCRIPT = `(()=>{try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
