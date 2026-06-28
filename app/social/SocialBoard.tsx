'use client';

import { useState, type ReactNode } from 'react';

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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// topic each badge belongs to + the order topics appear
const TOPIC: Record<string, string> = {
  'SUI TECH': 'How it works',
  LEVERAGE: 'How it works',
  'FULL PRODUCT': 'Product',
  ANCHOR: 'Manifesto',
  DRIP: 'Drip · drafts',
};
const TOPIC_ORDER = ['How it works', 'Product', 'Manifesto', 'Drip · drafts', 'Long-form', 'Assets'];
const topicOf = (badge: string) => TOPIC[badge] || 'More';
const tweetCount = (s: Section) => s.units.filter((u) => u.kind === 'tweet').length || s.units.length;

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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded border px-2 py-1 text-[10px] font-semibold tracking-[0.14em]"
      style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--vermilion)', borderColor: 'rgba(224,77,38,0.4)' }}
    >
      {children}
    </span>
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
          <span className="ml-auto text-[11px] font-semibold" style={{ fontFamily: 'var(--font-jetbrains)', color: over ? 'var(--vermilion)' : '#7a7a7a' }}>
            {len}
            {u.kind === 'tweet' ? '/280' : ''}
          </span>
        )}
        <CopyButton text={u.text} />
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-[#e8e8e8]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        {u.text}
      </pre>
      {u.img && <img src={`/social-assets/${u.img}`} alt="" loading="lazy" className="mt-3 w-full rounded-lg border border-white/10" />}
    </div>
  );
}

function SectionBlock({ s }: { s: Section }) {
  return (
    <section id={slug(s.title)} className="mb-12 scroll-mt-24">
      <h3 className="flex items-center gap-3 border-b border-white/10 pb-3 text-[15px] font-bold tracking-[0.02em]">
        {s.title}
        <Badge>{s.badge}</Badge>
        <span className="ml-auto text-[11px] text-[#5a5a5a]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          {tweetCount(s)} posts
        </span>
      </h3>
      {s.units.map((u, j) => (
        <UnitCard key={j} u={u} />
      ))}
    </section>
  );
}

export default function SocialBoard({ content }: { content: Manifest }) {
  // group sections by topic, preserving order
  const byTopic = new Map<string, Section[]>();
  for (const s of content.sections) {
    const t = topicOf(s.badge);
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t)!.push(s);
  }
  const topics = TOPIC_ORDER.filter(
    (t) => byTopic.has(t) || (t === 'Long-form' && content.essays.length) || (t === 'Assets' && content.cards.length),
  );
  for (const t of byTopic.keys()) if (!topics.includes(t)) topics.push(t);

  // TOC entries per topic
  const tocFor = (t: string): { label: string; sub: string; href: string }[] => {
    if (t === 'Long-form') return [{ label: `${content.essays.length} essays`, sub: '', href: '#long-form' }];
    if (t === 'Assets') return [{ label: `${content.cards.length} cards`, sub: '', href: '#assets' }];
    return (byTopic.get(t) || []).map((s) => ({ label: s.title, sub: `${s.badge} · ${tweetCount(s)}`, href: `#${slug(s.title)}` }));
  };

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
        {/* ── INDEX ── */}
        <div className="mb-12 rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 sm:p-6">
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6a6a73]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            Index
          </div>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {topics.map((t) => (
              <div key={t}>
                <div className="mb-2 text-[12px] font-bold tracking-[0.04em]" style={{ color: 'var(--vermilion)' }}>
                  {t}
                </div>
                <ul className="space-y-1.5">
                  {tocFor(t).map((e) => (
                    <li key={e.href}>
                      <a href={e.href} className="group flex items-baseline gap-2 text-[13.5px] text-[#cfcfcf] transition-colors hover:text-white">
                        <span className="leading-snug group-hover:underline">{e.label}</span>
                        {e.sub && (
                          <span className="ml-auto shrink-0 text-[10px] text-[#5a5a5a]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                            {e.sub}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* ── GROUPED CONTENT ── */}
        {topics.map((t) => {
          const secs = byTopic.get(t) || [];
          if (t === 'Long-form' || t === 'Assets') return null; // rendered below
          return (
            <div key={t} className="mb-16">
              <div className="mb-6 flex items-center gap-3">
                <h2 className="text-[13px] font-bold uppercase tracking-[0.22em]" style={{ fontFamily: 'var(--font-jetbrains)', color: '#8a8a92' }}>
                  {t}
                </h2>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              {secs.map((s, i) => (
                <SectionBlock key={i} s={s} />
              ))}
            </div>
          );
        })}

        {content.essays.length > 0 && (
          <div id="long-form" className="mb-16 scroll-mt-24">
            <div className="mb-6 flex items-center gap-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.22em]" style={{ fontFamily: 'var(--font-jetbrains)', color: '#8a8a92' }}>
                Long-form
              </h2>
              <div className="h-px flex-1 bg-white/10" />
            </div>
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
          </div>
        )}

        {content.cards.length > 0 && (
          <div id="assets" className="mb-16 scroll-mt-24">
            <div className="mb-6 flex items-center gap-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.22em]" style={{ fontFamily: 'var(--font-jetbrains)', color: '#8a8a92' }}>
                Assets
              </h2>
              <Badge>{content.cards.length} CARDS</Badge>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {content.cards.map((c) => (
                <a key={c} href={`/social-assets/${c}`} target="_blank" rel="noreferrer" className="block text-[10px] text-[#7a7a7a]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  <img src={`/social-assets/${c}`} alt={c} loading="lazy" className="mb-1.5 w-full rounded-lg border border-white/10" />
                  {c}
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-[#525252]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          generated {content.generatedAt}
        </p>
      </main>
    </div>
  );
}
