'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';

const SUISCAN = 'https://suiscan.xyz/testnet';

const CONTRACTS: { label: string; id: string; type: 'object' | 'tx' }[] = [
  { label: 'DeepBook Predict package', id: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138', type: 'object' },
  { label: 'yosuku_vault (attested agent vault)', id: '0x1c95fb3703d841e1cb7b0742c9426fc7fb4e3c35903c8efd67bb0ae625e5f034', type: 'object' },
  { label: 'Strategy market', id: '0x5bde72a992105011e851abd8f96026c27fc97440ac4db0a1f1356252b58be7dc', type: 'object' },
  { label: 'Attested Bellkeeper trade (proof)', id: '9zN7JacN5AdzKLRHRh5vDDocx5CTns6HqFSrfWEavAbj', type: 'tx' },
];

// Sidebar nav, grouped — the spine of the docs.
const NAV: { group: string; index: string; items: { id: string; label: string }[] }[] = [
  { group: 'Start here', index: '01', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'how-it-works', label: 'How a market works' },
    { id: 'four-ways', label: 'Four ways in' },
  ] },
  { group: 'Build', index: '02', items: [
    { id: 'sdk', label: 'The SDK' },
    { id: 'memory', label: 'Agent memory' },
    { id: 'mcp', label: 'MCP server' },
  ] },
  { group: 'Trust', index: '03', items: [
    { id: 'agent', label: 'The attested agent' },
    { id: 'verify', label: 'Verify on-chain' },
    { id: 'honest', label: 'What this is & isn’t' },
  ] },
];

const ALL_IDS = NAV.flatMap(g => g.items.map(i => i.id));

export default function DocsPage() {
  const [active, setActive] = useState('overview');

  // Scroll-spy: highlight the section currently in view.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-120px 0px -65% 0px', threshold: 0 },
    );
    ALL_IDS.forEach(id => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  const activeIdx = ALL_IDS.indexOf(active);
  const progress = ((activeIdx + 1) / ALL_IDS.length) * 100;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-28">
        <div className="flex gap-14">
          {/* ── Sidebar ── */}
          <aside className="hidden lg:block w-[224px] flex-shrink-0">
            <div className="sticky top-[120px]">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-gray-600 mb-6">
                <span className="font-jp text-vermilion/80 text-[13px] not-italic">予測</span>
                <span className="w-5 h-px bg-gray-800" />
                Docs
              </div>

              <nav className="space-y-7">
                {NAV.map(g => (
                  <div key={g.group}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="font-mono text-[9px] text-vermilion/60 tracking-[0.1em]">{g.index}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600">{g.group}</span>
                    </div>
                    <ul className="space-y-px border-l border-white/[0.07]">
                      {g.items.map(it => {
                        const on = active === it.id;
                        return (
                          <li key={it.id}>
                            <a
                              href={`#${it.id}`}
                              data-cursor="hover"
                              className={`group flex items-center gap-2 pl-3.5 -ml-px border-l py-[7px] text-[13px] transition-all duration-200 ${
                                on
                                  ? 'border-vermilion text-white'
                                  : 'border-transparent text-gray-500 hover:text-gray-200 hover:border-white/20'
                              }`}
                            >
                              <span className={`h-1 w-1 rounded-full transition-all ${on ? 'bg-vermilion scale-100' : 'bg-transparent scale-0'}`} />
                              {it.label}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>

              {/* progress + ship CTA */}
              <div className="mt-9 pt-6 border-t border-white/[0.06]">
                <div className="h-px w-full bg-white/[0.06] overflow-hidden mb-3">
                  <div className="h-px bg-vermilion transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-700 mb-3">Ship something</div>
                <div className="flex flex-col gap-1.5">
                  <a href="https://www.npmjs.com/package/@yosuku/deepbook-predict" target="_blank" rel="noreferrer" data-cursor="hover" className="font-mono text-[11px] text-gray-500 hover:text-vermilion transition-colors">npm ↗</a>
                  <a href="https://github.com/yosuku-lab/predict-sdk" target="_blank" rel="noreferrer" data-cursor="hover" className="font-mono text-[11px] text-gray-500 hover:text-vermilion transition-colors">source ↗</a>
                  <Link href="/bell" data-cursor="hover" className="font-mono text-[11px] text-gray-500 hover:text-vermilion transition-colors">make the call ↗</Link>
                </div>
              </div>
            </div>
          </aside>

          {/* ── Content ── */}
          <div className="min-w-0 flex-1 max-w-2xl">
            {/* Editorial masthead */}
            <header className="relative mb-16 pb-12 border-b border-white/[0.07] overflow-hidden">
              <span aria-hidden className="pointer-events-none select-none absolute -top-14 -right-6 font-jp font-bold leading-none text-[150px] md:text-[190px] text-white/[0.022]">予</span>
              {/* corner ticks */}
              <span aria-hidden className="absolute top-0 left-0 w-3.5 h-3.5 border-t border-l border-white/15" />
              <span aria-hidden className="absolute top-0 right-0 w-3.5 h-3.5 border-t border-r border-white/15" />

              <div className="relative flex items-center gap-2.5 mb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse" />
                Documentation
                <span className="w-6 h-px bg-gray-700" />
                DeepBook Predict
                <span className="w-6 h-px bg-gray-700 hidden sm:block" />
                <span className="hidden sm:inline">Testnet</span>
              </div>

              <h1 className="relative font-display font-extrabold tracking-tight leading-[1.02] mb-6 text-[clamp(2.4rem,6.5vw,4rem)]">
                The close, <span className="vermilion">documented</span>.
              </h1>

              <p className="relative text-gray-400 text-[17px] leading-relaxed max-w-2xl">
                Yosuku is a prediction market built on DeepBook Predict — Sui&apos;s volatility-surface-priced
                binary market. Pick a side on BTC, the oracle settles at close, the math decides. Below:
                how to trade, how to build on it, and how to verify every claim on-chain.
              </p>

              <div className="relative mt-8 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[11px] text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-vermilion" />@yosuku/deepbook-predict
                </span>
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[11px] text-gray-500">v0.3.0</span>
                <a href="#verify" data-cursor="hover" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-vermilion/30 bg-vermilion/[0.06] font-mono text-[11px] text-vermilion hover:bg-vermilion/10 transition-colors">Verified on-chain ↓</a>
              </div>
            </header>

            <Section num="01" id="overview" eyebrow="For everyone" title="Overview">
              <p className="text-[17px] text-gray-300 leading-relaxed">
                A market is one question — <em className="text-white not-italic">&ldquo;Will BTC be above $X at close?&rdquo;</em> —
                and you take <span className="text-white">UP</span> or <span className="text-white">DOWN</span>. There&apos;s no one on
                the other side: the price is computed live from a volatility surface (SVI → N(d2)), so a quote exists from the first
                second. At expiry the oracle reports the price, settlement is automatic, and winners are paid.
              </p>
            </Section>

            <Section num="02" id="how-it-works" eyebrow="For everyone" title="How a market works">
              <p>
                No order book, no counterparty, no claims to argue over. A vault quotes both sides and takes the other end of
                every trade; the oracle decides the outcome at close.
              </p>
              <KeyVals items={[
                ['Sign in', 'Google (zkLogin) — no seed phrase — or any Sui wallet'],
                ['Settle', 'Automatic at the oracle push. UP pays if price > strike (strict).'],
                ['Cost', 'Shown before you sign, matched to the chain within a fraction of a cent.'],
              ]} />
            </Section>

            <Section num="03" id="four-ways" eyebrow="For everyone" title="Four ways in">
              <Cards items={[
                { name: 'Tap', href: '/bell', body: 'One-tap UP/DOWN on the next round. The ritual.' },
                { name: 'Markets', href: '/markets', body: 'Every live strike, priced. Open a position at any level.' },
                { name: 'Pool', href: '/pool', body: 'Be the house — supply liquidity, earn the spread.' },
                { name: 'Strategies', href: '/strategies', body: 'Buy a strategist&apos;s playbook — verifiable, Seal-gated.' },
              ]} />
            </Section>

            <Section num="04" id="sdk" eyebrow="For builders" title="The SDK">
              <p>
                <code className="dcode">@yosuku/deepbook-predict</code> is the first TypeScript SDK for DeepBook Predict.
                Quote any strike, open a position, crank gas-negative redeems — in a handful of lines. The pricing engine
                (SVI → N(d2)) is importable on its own, and the indexer client is fully typed.
              </p>
              <Code label="quote.ts">{`npm i @yosuku/deepbook-predict

import { PredictClient } from '@yosuku/deepbook-predict';
const predict = new PredictClient();                 // testnet baked in
const oracle  = (await predict.indexer.activeOracles())[0];
const quote   = await predict.quote(oracle.oracle_id, 63_000);  // SVI · N(d2)`}</Code>
              <Links items={[
                ['npm', 'https://www.npmjs.com/package/@yosuku/deepbook-predict'],
                ['source', 'https://github.com/yosuku-lab/predict-sdk'],
              ]} />
            </Section>

            <Section num="05" id="memory" eyebrow="For builders" title="Agent memory">
              <p>
                <code className="dcode">@yosuku/deepbook-predict/memory</code> gives any trading agent portable,
                semantic memory — SEAL-encrypted, stored on Walrus, owned by a Sui account. Every lesson can carry the
                on-chain tx that taught it, so an agent&apos;s experience is as verifiable as its trades.
              </p>
            </Section>

            <Section num="06" id="mcp" eyebrow="For builders" title="MCP server — let an LLM trade">
              <p>
                <code className="dcode">@yosuku/deepbook-predict-mcp</code> is the first MCP server for DeepBook Predict.
                One line in any MCP client (Claude Desktop, Cursor) and an LLM can read markets, price any strike, place a
                position, and crank redeems — as tools.
              </p>
              <Code label="claude_desktop_config.json">{`{ "mcpServers": { "deepbook-predict": {
  "command": "npx", "args": ["-y", "@yosuku/deepbook-predict-mcp"] } } }`}</Code>
              <Links items={[['npm', 'https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp']]} />
            </Section>

            <Section num="07" id="agent" eyebrow="The moat" title="The attested agent">
              <p>
                The Bellkeeper is an autonomous strategist that trades a contract-custodied vault. Its authority is bounded
                <span className="text-white"> on-chain</span>, not by trust: every decision is signed inside a TEE, the signature is
                re-checked against the exact trade params, and hard caps are enforced regardless of what the agent said. An agent
                that <span className="text-white">provably can&apos;t overspend and can&apos;t lie about what it ran</span> — only
                possible because Sui verifies the attestation in the same transaction that places the trade.
              </p>
            </Section>

            <Section num="08" id="verify" eyebrow="Verify" title="Contracts &amp; proof">
              <p>Everything is on testnet. Don&apos;t trust it — click it.</p>
              <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.015] overflow-hidden">
                {CONTRACTS.map((c, i) => (
                  <a
                    key={c.id}
                    href={`${SUISCAN}/${c.type === 'tx' ? 'tx' : 'object'}/${c.id}`}
                    target="_blank" rel="noreferrer" data-cursor="hover"
                    className={`flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-white/[0.025] transition-colors group ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${c.type === 'tx' ? 'text-vermilion bg-vermilion/10' : 'text-gray-500 bg-white/[0.05]'}`}>{c.type === 'tx' ? 'TX' : 'PKG'}</span>
                      <span className="text-sm text-gray-300 group-hover:text-white transition-colors truncate">{c.label}</span>
                    </span>
                    <span className="font-mono text-[11px] text-gray-600 group-hover:text-vermilion transition-colors whitespace-nowrap">{c.id.slice(0, 10)}… ↗</span>
                  </a>
                ))}
              </div>
            </Section>

            {/* Honest — cream ledger plate, a tactile inversion of the dark page */}
            <section id="honest" className="mb-16 scroll-mt-[120px]">
              <SectionHead num="09" eyebrow="Honest" title="What this is and isn’t" />
              <div className="ledger-plate mt-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#A8997D] mb-5">Disclosure · 予測</div>
                <ul className="space-y-3.5">
                  {[
                    ['Testnet only.', 'DeepBook Predict is testnet today; mainnet IDs will change.'],
                    ['BTC only.', 'The live markets are Bitcoin; more assets come at mainnet.'],
                    ['~2% round-trip spread.', 'Shown transparently, never hidden.'],
                    ['Built on Sui’s own primitive', '— DeepBook Predict, Walrus, Seal, Nautilus, Move. Composed, not bolted on.'],
                  ].map(([term, detail]) => (
                    <li key={term} className="flex gap-3 text-[14.5px] leading-relaxed">
                      <span className="text-vermilion select-none mt-px">·</span>
                      <span><span className="font-semibold text-[#1A1612]">{term}</span> <span className="text-[#6E6557]">{detail}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-wrap items-center gap-x-7 gap-y-2">
              <Link href="/bell" className="font-display font-semibold text-white hover:text-vermilion transition-colors">Make the call →</Link>
              <a href="https://www.npmjs.com/package/@yosuku/deepbook-predict" target="_blank" rel="noreferrer" className="font-mono text-xs text-gray-500 hover:text-white transition-colors">npm ↗</a>
              <a href="https://x.com/yosuku0" target="_blank" rel="noreferrer" className="font-mono text-xs text-gray-500 hover:text-white transition-colors">@yosuku0 ↗</a>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function SectionHead({ num, eyebrow, title }: { num: string; eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="font-mono text-[11px] text-vermilion/70 tabular-nums">{num}</span>
        <span className="w-4 h-px bg-vermilion/40" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion/70">{eyebrow}</span>
      </div>
      <h2 className="font-display text-[26px] font-bold tracking-tight" dangerouslySetInnerHTML={{ __html: title }} />
    </div>
  );
}

function Section({ num, id, eyebrow, title, children }: { num: string; id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-16 scroll-mt-[120px]">
      <SectionHead num={num} eyebrow={eyebrow} title={title} />
      <div className="text-gray-400 text-[15px] leading-relaxed space-y-4">{children}</div>
    </section>
  );
}

function KeyVals({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.015] divide-y divide-white/[0.05]">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-5 px-4 py-3.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-vermilion/70 sm:w-16 shrink-0 pt-px">{k}</span>
          <span className="text-sm text-gray-300">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Cards({ items }: { items: { name: string; href: string; body: string }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
      {items.map((c, i) => (
        <Link key={c.name} href={c.href} data-cursor="hover" className="group relative border border-white/[0.07] rounded-2xl p-4 overflow-hidden hover:border-vermilion/40 hover:-translate-y-0.5 transition-all duration-200">
          <span className="absolute top-3.5 right-4 font-mono text-[10px] text-gray-700 group-hover:text-vermilion/70 transition-colors tabular-nums">0{i + 1}</span>
          <div className="font-display font-bold text-white mb-1 group-hover:text-vermilion transition-colors">{c.name}</div>
          <div className="text-[13px] text-gray-500" dangerouslySetInnerHTML={{ __html: c.body }} />
          <span className="absolute bottom-3.5 right-4 text-gray-700 group-hover:text-vermilion group-hover:translate-x-0.5 transition-all">→</span>
        </Link>
      ))}
    </div>
  );
}

// Lightweight syntax tinting — comments, strings, keywords, numbers.
function tokenize(line: string) {
  const re = /(\/\/.*$)|('[^']*'|"[^"]*"|`[^`]*`)|\b(import|from|const|let|await|new|return|export|function)\b|(\d[\d_]*)/g;
  const out: { t: string; v: string }[] = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: '', v: line.slice(last, m.index) });
    if (m[1]) out.push({ t: 'comment', v: m[1] });
    else if (m[2]) out.push({ t: 'string', v: m[2] });
    else if (m[3]) out.push({ t: 'keyword', v: m[3] });
    else if (m[4]) out.push({ t: 'num', v: m[4] });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ t: '', v: line.slice(last) });
  return out;
}

const TOK_CLASS: Record<string, string> = {
  comment: 'text-gray-600 italic',
  string: 'text-emerald-300/80',
  keyword: 'text-vermilion',
  num: 'text-amber-200/80',
  '': 'text-gray-300',
};

function Code({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };
  return (
    <div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#0a0a0a] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.015]">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-vermilion/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-300/40" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-300/40" />
          </span>
          <span className="font-mono text-[10px] text-gray-500 ml-1">{label}</span>
        </div>
        <button onClick={copy} data-cursor="hover" className="font-mono text-[10px] text-gray-600 hover:text-vermilion transition-colors">
          {copied ? 'copied ✓' : 'copy'}
        </button>
      </div>
      <pre className="px-4 py-4 overflow-x-auto font-mono text-[12.5px] leading-[1.7]">
        <code>
          {children.split('\n').map((line, i) => (
            <div key={i}>
              {line === '' ? ' ' : tokenize(line).map((tk, j) => (
                <span key={j} className={TOK_CLASS[tk.t]}>{tk.v}</span>
              ))}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function Links({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
      {items.map(([label, href]) => (
        <a key={href} href={href} target="_blank" rel="noreferrer" data-cursor="hover" className="font-mono text-xs text-gray-500 hover:text-vermilion transition-colors">{label} ↗</a>
      ))}
    </div>
  );
}
