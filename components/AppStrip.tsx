'use client';

// The thin line above the page.
//
// The first version scrolled two phrases on an endless loop in saturated vermilion caps, which
// is the visual grammar of an ad bar: repetition is what tells a reader "this is not
// information, it is someone shouting". It also fought the price ticker directly beneath it,
// so the top of the site had two moving strips competing.
//
// This one says one thing at a time, quietly, and changes only occasionally. It borrows the
// ticker's material rather than inventing a louder one, so it reads as part of the furniture,
// and spends its single point of colour on the one word you might act on. It can be dismissed,
// which is the difference between a message and a nag; the dismissal sticks.
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const KEY = 'yosuku.appstrip.dismissed';
const ROTATE_MS = 7000;

// Statements, not slogans. Each is a fact that survives being read twice.
const LINES = [
  'Yosuku is on iOS',
  'Try our mobile app, limited slots',
];

export default function AppStrip() {
  const pathname = usePathname();
  const [gone, setGone] = useState(true); // assume dismissed until storage says otherwise: avoids a flash
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    try { setGone(localStorage.getItem(KEY) === '1'); } catch { setGone(false); }
  }, []);

  useEffect(() => {
    if (gone) return;
    const t = setTimeout(() => setShown(true), 60); // let it arrive rather than snap in
    return () => clearTimeout(t);
  }, [gone]);

  useEffect(() => {
    if (gone || LINES.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % LINES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [gone]);

  // A strip inviting you to the page you are already reading is noise.
  const hidden = gone || !!pathname?.startsWith('/download');

  // Tell the stylesheet whether the strip is actually there. Every fixed offset on the site is
  // computed off --appstrip, so when the strip is absent that height has to collapse or the
  // header hangs in empty space with nothing above it. /download shows this worst: it has no
  // strip AND no price ticker, so the bar was floating 62px down a blank page.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.strip = hidden ? 'off' : 'on';
    return () => { delete el.dataset.strip; };
  }, [hidden]);

  if (hidden) return null;

  return (
    <div className={`appstrip ${shown ? 'is-in' : ''}`} role="region" aria-label="Mobile app">
      <a className="appstrip-msg" href="/download" data-cursor="hover">
        <i className="appstrip-dot" aria-hidden="true" />
        {/* Keyed so React swaps the node and the CSS animation re-runs on each change. */}
        <span className="appstrip-line" key={i}>{LINES[i]}</span>
        <span className="appstrip-go">
          Get it
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </a>
      <button
        className="appstrip-x"
        onClick={() => { try { localStorage.setItem(KEY, '1'); } catch {} setGone(true); }}
        aria-label="Dismiss"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
