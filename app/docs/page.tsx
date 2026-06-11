'use client';

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

export default function DocsPage() {
  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[140px] pb-24">
        <div className="max-w-3xl mx-auto">
          {/* hero */}
          <div className="mb-16">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 12px var(--vermilion)' }} />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">Docs · 予測</span>
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] mb-4">
              The bell, <span className="vermilion">documented</span>.
            </h1>
            <p className="text-gray-400 text-base leading-relaxed max-w-2xl">
              Yosuku is a prediction market built on DeepBook Predict — Sui&apos;s volatility-surface-priced
              binary market. Pick a side on BTC, the oracle settles at the bell, the math decides. Below:
              how to trade, how to build on it, and how to verify every claim on-chain.
            </p>
          </div>

          <Section eyebrow="For everyone" title="How a market works">
            <p>
              A market asks one question — <em className="text-white not-italic">&ldquo;Will BTC be above $X at the bell?&rdquo;</em> —
              and you take <span className="text-white">UP</span> or <span className="text-white">DOWN</span>. There&apos;s no one on
              the other side: the price is computed live from a volatility surface (SVI → N(d2)), so a quote exists from the first
              second. At expiry the oracle reports the price, settlement is automatic, and winners are paid. No order book, no
              counterparty, no claims to argue over.
            </p>
            <KeyVals items={[
              ['Sign in', 'Google (zkLogin) — no seed phrase — or any Sui wallet'],
              ['Settle', 'Automatic at the oracle push. UP pays if price > strike (strict).'],
              ['Cost', 'Shown before you sign, matched to the chain within a fraction of a cent.'],
            ]} />
          </Section>

          <Section eyebrow="For everyone" title="Four ways in">
            <Cards items={[
              { name: 'Tap', href: '/bell', body: 'One-tap UP/DOWN on the next bell. The ritual.' },
              { name: 'Markets', href: '/markets', body: 'Every live strike, priced. Open a position at any level.' },
              { name: 'Pool', href: '/pool', body: 'Be the house — supply liquidity, earn the spread.' },
              { name: 'Strategies', href: '/market', body: 'Buy a strategist&apos;s playbook — verifiable, Seal-gated.' },
            ]} />
          </Section>

          <Section eyebrow="For builders" title="The SDK">
            <p>
              <code className="text-vermilion">@yosuku/deepbook-predict</code> is the first TypeScript SDK for DeepBook Predict.
              Quote any strike, open a position, crank gas-negative redeems — in a handful of lines. The pricing engine
              (SVI → N(d2)) is importable on its own, and the indexer client is fully typed.
            </p>
            <Pre>{`npm i @yosuku/deepbook-predict

import { PredictClient } from '@yosuku/deepbook-predict';
const predict = new PredictClient();                 // testnet baked in
const oracle  = (await predict.indexer.activeOracles())[0];
const quote   = await predict.quote(oracle.oracle_id, 63_000);  // SVI · N(d2)`}</Pre>
            <Links items={[
              ['npm', 'https://www.npmjs.com/package/@yosuku/deepbook-predict'],
              ['source', 'https://github.com/yosuku-lab/predict-sdk'],
            ]} />
          </Section>

          <Section eyebrow="For builders" title="Agent memory">
            <p>
              <code className="text-vermilion">@yosuku/deepbook-predict/memory</code> gives any trading agent portable,
              semantic memory — SEAL-encrypted, stored on Walrus, owned by a Sui account. Every lesson can carry the
              on-chain tx that taught it, so an agent&apos;s experience is as verifiable as its trades.
            </p>
          </Section>

          <Section eyebrow="For builders" title="MCP server — let an LLM trade">
            <p>
              <code className="text-vermilion">@yosuku/deepbook-predict-mcp</code> is the first MCP server for DeepBook Predict.
              One line in any MCP client (Claude Desktop, Cursor) and an LLM can read markets, price any strike, place a
              position, and crank redeems — as tools.
            </p>
            <Pre>{`{ "mcpServers": { "deepbook-predict": {
  "command": "npx", "args": ["-y", "@yosuku/deepbook-predict-mcp"] } } }`}</Pre>
            <Links items={[['npm', 'https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp']]} />
          </Section>

          <Section eyebrow="The moat" title="The attested agent">
            <p>
              The Bellkeeper is an autonomous strategist that trades a contract-custodied vault. Its authority is bounded
              <span className="text-white"> on-chain</span>, not by trust: every decision is signed inside a TEE, the signature is
              re-checked against the exact trade params, and hard caps are enforced regardless of what the agent said. An agent
              that <span className="text-white">provably can&apos;t overspend and can&apos;t lie about what it ran</span> — only
              possible because Sui verifies the attestation in the same transaction that places the trade.
            </p>
          </Section>

          <Section eyebrow="Verify" title="Contracts &amp; proof">
            <p>Everything is on testnet. Don&apos;t trust it — click it.</p>
            <div className="mt-4 space-y-1.5">
              {CONTRACTS.map((c) => (
                <a
                  key={c.id}
                  href={`${SUISCAN}/${c.type === 'tx' ? 'tx' : 'object'}/${c.id}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-baseline justify-between gap-4 py-2 border-b border-white/[0.05] hover:border-white/15 transition-colors group"
                >
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{c.label}</span>
                  <span className="font-mono text-[11px] text-gray-600 group-hover:text-vermilion transition-colors truncate max-w-[45%]">{c.id.slice(0, 10)}… ↗</span>
                </a>
              ))}
            </div>
          </Section>

          <Section eyebrow="Honest" title="What this is and isn't">
            <ul className="space-y-2 text-sm text-gray-400 list-none pl-0">
              <li>· <span className="text-white">Testnet only.</span> DeepBook Predict is testnet today; mainnet IDs will change.</li>
              <li>· <span className="text-white">BTC only.</span> The live markets are Bitcoin; more assets come at mainnet.</li>
              <li>· <span className="text-white">~2% round-trip spread.</span> Shown transparently, never hidden.</li>
              <li>· <span className="text-white">Built on Sui&apos;s own primitive</span> — DeepBook Predict, Walrus, Seal, Nautilus, Move. Composed, not bolted on.</li>
            </ul>
          </Section>

          <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/bell" className="font-display font-semibold text-white hover:text-vermilion transition-colors">Ring the bell →</Link>
            <a href="https://www.npmjs.com/package/@yosuku/deepbook-predict" target="_blank" rel="noreferrer" className="font-mono text-xs text-gray-500 hover:text-white transition-colors">npm ↗</a>
            <a href="https://x.com/yosuku0" target="_blank" rel="noreferrer" className="font-mono text-xs text-gray-500 hover:text-white transition-colors">@yosuku0 ↗</a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion/70 mb-2">{eyebrow}</div>
      <h2 className="font-display text-2xl font-bold tracking-tight mb-4" dangerouslySetInnerHTML={{ __html: title }} />
      <div className="text-gray-400 text-[15px] leading-relaxed space-y-4">{children}</div>
    </section>
  );
}

function KeyVals({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600 sm:w-20 shrink-0">{k}</span>
          <span className="text-sm text-gray-300">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Cards({ items }: { items: { name: string; href: string; body: string }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
      {items.map((c) => (
        <Link key={c.name} href={c.href} className="border border-white/[0.06] rounded-xl p-4 hover:border-white/15 hover:-translate-y-0.5 transition-all">
          <div className="font-display font-bold text-white mb-1">{c.name}</div>
          <div className="text-[13px] text-gray-500" dangerouslySetInnerHTML={{ __html: c.body }} />
        </Link>
      ))}
    </div>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-4 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 overflow-x-auto font-mono text-[12.5px] leading-relaxed text-gray-300">
      {children}
    </pre>
  );
}

function Links({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
      {items.map(([label, href]) => (
        <a key={href} href={href} target="_blank" rel="noreferrer" className="font-mono text-xs text-gray-500 hover:text-vermilion transition-colors">{label} ↗</a>
      ))}
    </div>
  );
}
