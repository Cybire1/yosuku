import { useEffect } from 'react';

type ShortcutMap = Record<string, () => void>;

export function useKeyboardShortcuts(map: ShortcutMap) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in form elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map]);
}
