'use client';

import { useState } from 'react';

type Unit = {
  kind: 'tweet' | 'reply' | 'post';
  n?: string;
  total?: string;
  label?: string;
  text: string;
  img?: string | null;
};
type Section = { title: string; badge: string; units: Unit[] };
type Essay = { title: string; markdown: string };
export type Manifest = { generatedAt: string; sections: Section[]; essays: Essay[]; cards: string[] };

const cp = (s: string) => [...s].length;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1100);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="ml-auto rounded-full px-4 py-[7px] text-xs font-semibold transition-colors"
      style={{ background: done ? 'var(--vermilion)' : '#fff', color: done ? '#fff' : '#111' }}
    >
      {done ? 'copied' : 'copy'}
    </button>
  );
}

function UnitCard({ u }: { u: Unit }) {
  const len = cp(u.text);
  const over = u.kind === 'tweet' && len > 280;
  const tag = u.kind === 'tweet' ? `${u.n}/${u.total}` : u.kind === 'reply' ? 'reply #1' : u.label || 'post';
  return (
    <div className="my-3.5 rounded-xl border border-white/10 bg-[#0c0c0c] p-4">
      <div className="mb-2.5 flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7a7a7a]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          {tag}
        </span>
        {u.kind !== 'reply' && (
          <span
            className="ml-auto text-[11px] font-semibold"
            style={{ fontFamily: 'var(--font-jetbrains)', color: over ? 'var(--vermilion)' : '#7a7a7a' }}
          >
            {len}
            {u.kind === 'tweet' ? '/280' : ''}
          </span>
        )}
        <CopyButton text={u.text} />
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-[#e8e8e8]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        {u.text}
      </pre>
      {u.img && (
        <img src={`/social-assets/${u.img}`} alt="" loading="lazy" className="mt-3 w-full rounded-lg border border-white/10" />
      )}
    </div>
  );
}

export default function SocialBoard({ content }: { content: Manifest }) {
  return (
    <div className="min-h-screen bg-[#050505] pb-32 text-[#e8e8e8]">
      <header className="sticky top-0 z-10 flex items-center gap-3.5 border-b border-white/10 bg-[#050505]/90 px-6 py-[18px] backdrop-blur-md sm:px-8">
        <span className="relative inline-block h-[22px] w-[22px] rounded-full border-2 border-white">
          <span className="absolute left-1/2 top-0 h-[22px] w-[2px] -translate-x-1/2" style={{ background: 'var(--vermilion)' }} />
        </span>
        <b className="font-extrabold tracking-[0.05em]" style={{ fontFamily: 'var(--font-sora)' }}>
          YOSUKU
        </b>
        <span className="text-[#7a7a7a]">· social</span>
        <span className="ml-auto hidden text-[13px] text-[#7a7a7a] sm:inline">click any · copy · paste into X</span>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        {content.sections.map((s, i) => (
          <section key={i} className="mb-14">
            <h2 className="flex items-center gap-3 border-b border-white/10 pb-3 text-[15px] font-bold tracking-[0.02em]">
              {s.title}
              <span
                className="rounded border px-2 py-1 text-[10px] font-semibold tracking-[0.14em]"
                style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--vermilion)', borderColor: 'rgba(224,77,38,0.4)' }}
              >
                {s.badge}
              </span>
            </h2>
            {s.units.map((u, j) => (
              <UnitCard key={j} u={u} />
            ))}
          </section>
        ))}

        {content.essays.length > 0 && (
          <section className="mb-14">
            <h2 className="flex items-center gap-3 border-b border-white/10 pb-3 text-[15px] font-bold tracking-[0.02em]">
              Long-form
              <span
                className="rounded border px-2 py-1 text-[10px] font-semibold tracking-[0.14em]"
                style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--vermilion)', borderColor: 'rgba(224,77,38,0.4)' }}
              >
                ESSAYS
              </span>
            </h2>
            {content.essays.map((e, i) => (
              <details key={i} className="my-3.5 rounded-xl border border-white/10 bg-[#0c0c0c] p-4">
                <summary className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
                  {e.title}
                  <span onClick={(ev) => ev.preventDefault()} className="ml-auto">
                    <CopyButton text={e.markdown} />
                  </span>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-[#c8c8c8]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  {e.markdown}
                </pre>
              </details>
            ))}
          </section>
        )}

        {content.cards.length > 0 && (
          <section className="mb-14">
            <h2 className="flex items-center gap-3 border-b border-white/10 pb-3 text-[15px] font-bold tracking-[0.02em]">
              Assets
              <span
                className="rounded border px-2 py-1 text-[10px] font-semibold tracking-[0.14em]"
                style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--vermilion)', borderColor: 'rgba(224,77,38,0.4)' }}
              >
                {content.cards.length} CARDS
              </span>
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {content.cards.map((c) => (
                <a key={c} href={`/social-assets/${c}`} target="_blank" rel="noreferrer" className="block text-[10px] text-[#7a7a7a]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  <img src={`/social-assets/${c}`} alt={c} loading="lazy" className="mb-1.5 w-full rounded-lg border border-white/10" />
                  {c}
                </a>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-center text-[11px] text-[#525252]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          generated {content.generatedAt}
        </p>
      </main>
    </div>
  );
}
