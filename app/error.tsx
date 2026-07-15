'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Route-level error boundary. Without this, an unexpected render/runtime error
 * (e.g. a transient oracle/RPC hiccup) unmounts the tree and leaves a blank
 * page. This degrades that failure into a calm, on-brand fallback that keeps a
 * clear way forward — a retry and a route out — in both light and dark themes.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for logs without breaking the UI.
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '20px',
        padding: '48px 24px',
        background: 'var(--bg)',
        color: 'var(--white)',
      }}
    >
      <div
        aria-hidden
        style={{
          fontFamily: 'var(--font-jp)',
          fontSize: '64px',
          lineHeight: 1,
          color: 'var(--vermilion)',
          opacity: 0.9,
        }}
      >
        {'静'}
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        A quiet moment on the floor.
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: '15px',
          maxWidth: '440px',
          margin: 0,
          color: 'var(--gray-400)',
          lineHeight: 1.6,
        }}
      >
        Something interrupted this view. Your funds and positions are safe on-chain
        &mdash; this is only the screen. Try again, or head back to the markets.
      </p>
      <div
        style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: '8px',
        }}
      >
        <button
          onClick={() => reset()}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#FBF7EE',
            background: 'var(--vermilion)',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 22px',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <Link
          href="/markets"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--white)',
            background: 'transparent',
            border: '1px solid var(--gray-700)',
            borderRadius: '8px',
            padding: '12px 22px',
            textDecoration: 'none',
          }}
        >
          Go to markets
        </Link>
      </div>
    </div>
  );
}
