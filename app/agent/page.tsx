'use client';

import { useEffect, useState } from 'react';

type Attestation = {
  live: boolean;
  verified: boolean;
  pcr0: string;
  pcr2: string;
  pcr0Matches?: boolean;
  pcr2Matches?: boolean;
  moduleId?: string;
  docBytes?: number;
  enclaveUrl?: string;
  fetchedAt?: string;
  error?: string;
};

const TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const OBJ = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;

const DESK = '0x0c47d0aebe44f29c8e7d60d97a38ee327451485c0d5d5916a99f744da1ed7b09';
const KEEPER = '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244';
const FILL_TX = 'C9Ytpaz4Gs4mw6oZQJG72qbojZzifbVEsXcKCFa7Ngbv';
const LIQ_TX = '25oYXrRSfZUQn58mfgAv8T8iH2ztcsRmAQewZJK51WXW';

function short(s: string, n = 6) {
  return s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s;
}

export default function AgentPage() {
  const [att, setAtt] = useState<Attestation | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch('/api/attestation', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setAtt)
      .catch(() => setAtt({ live: false, verified: false, pcr0: '', pcr2: '' }))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const ok = att?.live && att?.verified;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-neutral-200">
      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">The desk operator</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">An agent you can verify</h1>
      <p className="mt-3 leading-relaxed text-neutral-400">
        Leverage on Yosuku is run by an autonomous agent — it fronts pool capital, opens the
        leveraged position into custody, and liquidates it at the live mark if health breaks, so
        lenders are protected. The agent runs inside an <strong className="text-neutral-200">AWS
        Nitro TEE</strong>, so you can cryptographically verify the <em>exact</em> code it runs —
        and the on-chain contract makes it unable to divert a cent.
      </p>

      {/* live attestation */}
      <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                loading ? 'bg-amber-400' : ok ? 'bg-emerald-400' : 'bg-red-500'
              }`}
            />
            <span className="text-sm font-medium text-white">
              {loading ? 'checking enclave…' : ok ? 'Attested · live · verified' : att?.live ? 'Live (PCR mismatch)' : 'Enclave offline'}
            </span>
          </div>
          <button onClick={refresh} className="text-xs text-neutral-400 hover:text-white">
            refresh
          </button>
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          <Row k="PCR0 (code measurement)">
            <code className="break-all text-emerald-300">{short(att?.pcr0 || '', 12)}</code>
            {att?.pcr0Matches && <span className="ml-2 text-emerald-400">✓ matches build</span>}
          </Row>
          <Row k="PCR2">
            <code className="break-all text-emerald-300/80">{short(att?.pcr2 || '', 12)}</code>
          </Row>
          {att?.moduleId && (
            <Row k="enclave module">
              <code className="break-all text-neutral-300">{att.moduleId}</code>
            </Row>
          )}
        </dl>

        {att?.enclaveUrl && (
          <a
            href={att.enclaveUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-xs text-sky-400 hover:text-sky-300"
          >
            verify it yourself → the raw Nitro attestation document
          </a>
        )}
      </section>

      {/* what it can / can't do */}
      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <Card title="What the agent does">
          <li>Fills traders’ leveraged orders (borrows from the pool, mints into custody)</li>
          <li>Marks every position to the live redeem price</li>
          <li>Liquidates before settlement when health drops — repaying lenders</li>
        </Card>
        <Card title="What it cannot do">
          <li>Divert funds — every exit force-pays the position owner or the pool</li>
          <li>Fake a liquidation — the contract asserts it on real redeemed proceeds</li>
          <li>Hold your margin hostage — you cancel anytime before fill</li>
        </Card>
      </section>

      {/* the proof */}
      <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">Proof — one autonomous cycle, on testnet</h2>
        <p className="mt-1 text-sm text-neutral-400">
          A trader opened a 10× position. With no human in the loop, the attested enclave filled it,
          then — seeing it fall under the 120% maintenance line — liquidated it and made the pool whole.
        </p>
        <ol className="mt-4 space-y-2 text-sm">
          <Step n="1" label="Enclave fills (borrows 9, mints the position into custody)">
            <a className="text-sky-400 hover:text-sky-300" target="_blank" rel="noreferrer" href={TX(FILL_TX)}>
              {short(FILL_TX, 8)} ↗
            </a>
          </Step>
          <Step n="2" label="Enclave liquidates at mark · repaid pool 9 · penalty 0.48 · shortfall 0">
            <a className="text-sky-400 hover:text-sky-300" target="_blank" rel="noreferrer" href={TX(LIQ_TX)}>
              {short(LIQ_TX, 8)} ↗
            </a>
          </Step>
        </ol>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
          <a className="hover:text-neutral-300" target="_blank" rel="noreferrer" href={OBJ(DESK)}>
            margin desk {short(DESK)}
          </a>
          <a className="hover:text-neutral-300" target="_blank" rel="noreferrer" href={OBJ(KEEPER)}>
            agent keeper {short(KEEPER)}
          </a>
        </div>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-neutral-600">
        DeepBook is designing native leverage for a continuous market that isn’t live yet. Yosuku
        shipped it on the binary market that is — operated by an agent you can attest, today.
      </p>
    </main>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-44 shrink-0 text-neutral-500">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-400">{children}</ul>
    </div>
  );
}

function Step({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-300">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-neutral-300">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </li>
  );
}
