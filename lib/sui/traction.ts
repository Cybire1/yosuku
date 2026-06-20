// HONEST, attributable on-chain traction. Two distinct kinds of proof — never conflated:
//
//  1. ADOPTION (real users we acquired): wallets whose gas Yosuku PAID via the Onara
//     sponsor. This is un-fakeable — the chain records Yosuku as the gas sponsor, so each
//     distinct sender provably came THROUGH Yosuku (not the broader Predict network). Plus
//     on-chain waitlist signups. Yosuku's own infra/test wallets are EXCLUDED so the count
//     is real external users, not us.
//
//  2. CAPABILITY (the engine, proven on real txs): tweet-trades, leverage opens, and
//     liquidations our contracts executed on testnet — proof the machine works. This
//     INCLUDES our own demo/test runs and is labeled as such; it is NOT a user count.
//
// Everything reads straight from chain via GraphQL. Verifiable, not self-reported.
import { gql } from './modernClients';
import { DUSDC_MULTIPLIER } from './constants';

// Yosuku's Onara gas sponsor — a tx it sponsored is provably a Yosuku user action.
const ONARA = '0xe26c11844116abb0d3d76fb88a25831f4a22cbbb3fee6bf096d779875a0c4c69';
const WAITLIST_PKG = '0x13d6dd6cb7effa390d60a259640d1640fda5d7b5be9f8c6019eaf7e34923bff9';
// margin keeps the ORIGINAL pkg id after upgrade; social_vault is at the NEW pkg id.
const MARGIN = '0xa3b75354df203da7b434efb55f6573f72fb656e3897082b575be86dc291cee44';
const VAULTPKG = '0xf3c3c446d233c4371c0faa4bf7aa07f740e1c3eac7956e1d128bf6ead09d0706';
const YOLEV = '0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36';

// Our own infra/test wallets — excluded from REAL-USER counts (keeper, deployer, the
// quirky-euclase test wallet, the enclave key, the bell agent, the faucet, Onara itself).
const INTERNAL_PREFIXES = ['0xaa50ec0f', '0x799ef16a', '0x0099f972', '0x4209aa27', '0x13f2fee3', '0x7c89c67c', '0xe26c1184'];
const isInternal = (a: string) => { const l = (a || '').toLowerCase(); return INTERNAL_PREFIXES.some((p) => l.startsWith(p)); };

export interface Interaction {
  kind: 'onboard' | 'waitlist' | 'tweet-trade' | 'leverage' | 'liquidation' | 'deposit';
  user: string;
  amount: number;     // DUSDC (0 where N/A)
  digest: string | null;
  ts: number;         // ms epoch
}

export interface GrowthPoint { day: string; cumulative: number; }

export interface TractionStats {
  // — Adoption (real, attributable users) —
  onboardedUsers: number;     // distinct external wallets Yosuku gas-sponsored
  sponsoredActions: number;   // gas-free actions Yosuku paid for (external users)
  waitlistSignups: number;    // distinct external wallets on the on-chain waitlist
  growth: GrowthPoint[];      // cumulative onboarded users by day (the curve)
  // — Capability (engine proven on-chain; includes our demo runs) —
  proven: { tweetTrades: number; leverageOpens: number; liquidations: number; volumeDusdc: number };
  // — Honest, labeled recent activity —
  recent: Interaction[];
  updatedAt: number;
}

type SponsoredTxNode = {
  digest: string;
  sender: { address: string } | null;
  gasInput: { gasSponsor: { address: string } | null } | null;
  effects: { timestamp: string | null } | null;
};

type SponsoredTxResponse = {
  transactions: {
    pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
    nodes: SponsoredTxNode[];
  };
};

type EventNode = {
  timestamp: string | null;
  sender: { address: string };
  contents: { json: Record<string, unknown> };
  transaction: { digest: string } | null;
};

type EventsResponse = {
  events: { nodes: EventNode[] };
};

type GqlResult<T> = {
  data?: T | null;
  errors?: unknown[] | null;
};

const SPON_Q = `query Spon($a: SuiAddress!, $before: String) {
  transactions(last: 50, before: $before, filter: { affectedAddress: $a }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { digest sender { address } gasInput { gasSponsor { address } } effects { timestamp } }
  }
}`;

const WL_Q = `query Wl($t: String!) {
  events(last: 50, filter: { type: $t }) {
    nodes { timestamp sender { address } contents { json } transaction { digest } }
  }
}`;

const EVENTS_Q = `query Tr($t: String!, $last: Int!) {
  events(last: $last, filter: { type: $t }) {
    nodes { timestamp sender { address } contents { json } transaction { digest } }
  }
}`;

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function fetchTraction(): Promise<TractionStats> {
  const recent: Interaction[] = [];

  // ── 1. Adoption: Onara-sponsored real users (paginate; cap at 6 pages = 300 tx) ──
  const firstSeen = new Map<string, number>(); // external user → earliest sponsored ts
  let sponsoredActions = 0;
  let before: string | null = null;
  try {
    for (let page = 0; page < 6; page++) {
      const result: GqlResult<SponsoredTxResponse> = await gql.query({
        query: SPON_Q,
        variables: { a: ONARA, before },
      });
      const { data, errors } = result;
      if (errors?.length || !data) break;
      for (const n of data.transactions.nodes) {
        const sponsor = n.gasInput?.gasSponsor?.address;
        const sender = n.sender?.address ?? '';
        if (sponsor !== ONARA || !sender || sender === ONARA || isInternal(sender)) continue;
        const ts = n.effects?.timestamp ? Date.parse(n.effects.timestamp) : 0;
        sponsoredActions++;
        const prev = firstSeen.get(sender);
        if (prev == null || ts < prev) firstSeen.set(sender, ts);
        recent.push({ kind: 'onboard', user: sender, amount: 0, digest: n.digest, ts });
      }
      const pi = data.transactions.pageInfo;
      if (!pi.hasPreviousPage || !pi.startCursor) break;
      before = pi.startCursor;
    }
  } catch { /* leave adoption at what we gathered */ }

  // cumulative growth curve (distinct users by first-seen day)
  const byDay = new Map<string, number>();
  for (const [, ts] of firstSeen) { if (ts) { const k = dayKey(ts); byDay.set(k, (byDay.get(k) ?? 0) + 1); } }
  const growth: GrowthPoint[] = [];
  let cum = 0;
  for (const day of [...byDay.keys()].sort()) { cum += byDay.get(day) ?? 0; growth.push({ day, cumulative: cum }); }

  // ── 2. Adoption: on-chain waitlist signups (external) ──
  const wlWallets = new Set<string>();
  try {
    const result: GqlResult<EventsResponse> = await gql.query({
      query: WL_Q,
      variables: { t: `${WAITLIST_PKG}::waitlist::Joined` },
    });
    const { data, errors } = result;
    if (!errors?.length && data) {
      for (const n of data.events.nodes) {
        const who = String((n.contents?.json?.who as string) ?? n.sender.address);
        if (isInternal(who)) continue;
        wlWallets.add(who);
        recent.push({ kind: 'waitlist', user: who, amount: 0, digest: n.transaction?.digest ?? null, ts: n.timestamp ? Date.parse(n.timestamp) : 0 });
      }
    }
  } catch { /* skip */ }

  // ── 3. Capability proven on-chain (includes our demo runs — labeled, not a user count) ──
  let tweetTrades = 0, leverageOpens = 0, liquidations = 0, volume = 0;
  const PROVEN: Array<{ type: string; kind: Interaction['kind']; userField: string; amountField?: string; volume?: boolean }> = [
    { type: `${VAULTPKG}::social_vault::AgentTraded`, kind: 'tweet-trade', userField: 'user', amountField: 'margin', volume: true },
    { type: `${MARGIN}::margin::PositionOpened`, kind: 'leverage', userField: 'owner', amountField: 'notional', volume: true },
    { type: `${MARGIN}::margin::Liquidated`, kind: 'liquidation', userField: 'owner', amountField: 'proceeds' },
    { type: `${YOLEV}::underwrite::OrderFilled`, kind: 'leverage', userField: 'trader', amountField: 'notional', volume: true },
  ];
  await Promise.all(PROVEN.map(async (s) => {
    try {
      const result: GqlResult<EventsResponse> = await gql.query({
        query: EVENTS_Q,
        variables: { t: s.type, last: 50 },
      });
      const { data, errors } = result;
      if (errors?.length || !data) return;
      for (const n of data.events.nodes) {
        const j = n.contents?.json ?? {};
        const user = String((j[s.userField] as string) ?? n.sender.address);
        if (s.kind === 'tweet-trade') tweetTrades++;
        else if (s.kind === 'liquidation') liquidations++;
        else if (s.kind === 'leverage') leverageOpens++;
        const amount = s.amountField ? Number(j[s.amountField] ?? 0) / DUSDC_MULTIPLIER : 0;
        if (s.volume) volume += amount;
        recent.push({ kind: s.kind, user, amount, digest: n.transaction?.digest ?? null, ts: n.timestamp ? Date.parse(n.timestamp) : 0 });
      }
    } catch { /* skip a source */ }
  }));

  recent.sort((a, b) => b.ts - a.ts);
  return {
    onboardedUsers: firstSeen.size,
    sponsoredActions,
    waitlistSignups: wlWallets.size,
    growth,
    proven: { tweetTrades, leverageOpens, liquidations, volumeDusdc: volume },
    recent: recent.slice(0, 30),
    updatedAt: Date.now(),
  };
}
