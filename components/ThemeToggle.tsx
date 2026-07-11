'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { resolveTheme, toggleTheme, type Theme } from '@/lib/theme';

// ☀ / ☾ — flips the cream light / ink dark theme. The <head> init script has
// already set data-theme before paint; we just mirror it into state on mount so
// the icon matches, then toggle + persist on click.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(resolveTheme());
    setMounted(true);
  }, []);

  // Render a stable placeholder until mounted so SSR/CSR markup matches.
  if (!mounted) {
    return <button className="theme-toggle" aria-hidden="true" tabIndex={-1} />;
  }

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      data-cursor="hover"
      onClick={() => setTheme(toggleTheme(theme))}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
