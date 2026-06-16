// Live on-chain traction — the un-fakeable proof of usage. Aggregates real events
// emitted by Yosuku's own contracts (tweet-trades, leveraged opens, liquidations,
// vault deposits) straight from chain via GraphQL. Distinct USERS are read from the
// event PAYLOAD (the agent signs the tx, so the tx sender is the keeper — the real
// trader is `user`/`owner`/`trader` inside the event), and every interaction links to
// its transaction on suiscan. Verifiable, not self-reported.
import { gql } from './modernClients';
import { DUSDC_MULTIPLIER } from './constants';

// runtime/type addresses: margin module keeps the ORIGINAL package id after the upgrade;
// social_vault (added in the upgrade) is typed at the NEW package id.
const MARGIN = '0xa3b75354df203da7b434efb55f6573f72fb656e3897082b575be86dc291cee44';
const VAULTPKG = '0xf3c3c446d233c4371c0faa4bf7aa07f740e1c3eac7956e1d128bf6ead09d0706';
const YOLEV = '0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36';

interface Source { type: string; kind: Interaction['kind']; userField: string; amountField?: string; volume?: boolean; }
const SOURCES: Source[] = [
  { type: `${VAULTPKG}::social_vault::AgentTraded`, kind: 'tweet-trade', userField: 'user', amountField: 'margin', volume: true },
  { type: `${VAULTPKG}::social_vault::Deposited`,   kind: 'deposit',     userField: 'user', amountField: 'amount' },
  { type: `${MARGIN}::margin::PositionOpened`,       kind: 'leverage',    userField: 'owner', amountField: 'notional', volume: true },
  { type: `${MARGIN}::margin::Liquidated`,           kind: 'liquidation', userField: 'owner', amountField: 'proceeds' },
  { type: `${YOLEV}::underwrite::OrderFilled`,       kind: 'leverage',    userField: 'trader', amountField: 'notional', volume: true },
];

const EVENTS_Q = `query Tr($t: String!, $last: Int!) {
  events(last: $last, filter: { type: $t }) {
    nodes { timestamp sender { address } contents { json } transaction { digest } }
  }
}`;

export interface Interaction {
  kind: 'tweet-trade' | 'leverage' | 'liquidation' | 'deposit';
  user: string;
  amount: number;     // DUSDC
  digest: string | null;
  ts: number;         // ms epoch
}

export interface TractionStats {
  distinctWallets: number;
  interactions: number;   // total on-chain interactions with our contracts
  tweetTrades: number;
  liquidations: number;
  volumeDusdc: number;    // notional deployed across opens
  recent: Interaction[];
  updatedAt: number;
}

export async function fetchTraction(perSource = 50): Promise<TractionStats> {
  const wallets = new Set<string>();
  let interactions = 0, tweetTrades = 0, liquidations = 0, volume = 0;
  const recent: Interaction[] = [];

  await Promise.all(SOURCES.map(async (s) => {
    try {
      const { data, errors } = await gql.query<{ events: { nodes: Array<{ timestamp: string | null; sender: { address: string }; contents: { json: Record<string, unknown> }; transaction: { digest: string } | null }> } }>({
        query: EVENTS_Q,
        variables: { t: s.type, last: perSource },
      });
      if (errors?.length || !data) return;
      for (const n of data.events.nodes) {
        const j = n.contents?.json ?? {};
        const user = String((j[s.userField] as string) ?? n.sender.address);
        wallets.add(user);
        interactions++;
        if (s.kind === 'tweet-trade') tweetTrades++;
        if (s.kind === 'liquidation') liquidations++;
        const amount = s.amountField ? Number(j[s.amountField] ?? 0) / DUSDC_MULTIPLIER : 0;
        if (s.volume) volume += amount;
        recent.push({ kind: s.kind, user, amount, digest: n.transaction?.digest ?? null, ts: n.timestamp ? Date.parse(n.timestamp) : 0 });
      }
    } catch { /* skip a source that errors — the page still renders the rest */ }
  }));

  recent.sort((a, b) => b.ts - a.ts);
  return {
    distinctWallets: wallets.size,
    interactions,
    tweetTrades,
    liquidations,
    volumeDusdc: volume,
    recent: recent.slice(0, 30),
    updatedAt: Date.now(),
  };
}
