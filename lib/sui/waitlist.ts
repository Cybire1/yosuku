// On-chain waitlist (testnet today; reserves a spot for the future mainnet launch) —
// joining is a signed tx by a real wallet (verifiable demand,
// not a vanity email). Reads count/membership off-chain via GraphQL+gRPC; the join tx is
// signed by the wallet and executed via gRPC (see modernClients.buildSignExecute).
import { Transaction } from '@mysten/sui/transactions';
import { readClient, simulateReturnBool, simulateReturnU64s } from './modernClients';
import { CLOCK_ID } from './constants';

export const WAITLIST_PKG = '0x13d6dd6cb7effa390d60a259640d1640fda5d7b5be9f8c6019eaf7e34923bff9';
export const WAITLIST_ID = '0x481d0a2b4aa19d25d7dfb37571b493a0e32b751c364ece728a83365f2603f9aa';
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';

export interface WaitlistState {
  count: number;
  joined: boolean;
  position: number | null;
}

export async function fetchWaitlist(address?: string | null): Promise<WaitlistState> {
  const r = await readClient.getObject({ id: WAITLIST_ID });
  const count = Number((r.data.content.fields as Record<string, unknown> | null)?.count ?? 0);
  let joined = false;
  let position: number | null = null;
  if (address) {
    try {
      const t = new Transaction();
      t.moveCall({ target: `${WAITLIST_PKG}::waitlist::has_joined`, arguments: [t.object(WAITLIST_ID), t.pure.address(address)] });
      joined = await simulateReturnBool(t, address, 0);
      if (joined) {
        const pt = new Transaction();
        pt.moveCall({ target: `${WAITLIST_PKG}::waitlist::position_of`, arguments: [pt.object(WAITLIST_ID), pt.pure.address(address)] });
        const [pos] = await simulateReturnU64s(pt, address, 0);
        position = pos != null ? Number(pos) : null;
      }
    } catch { /* treat as not-joined on read error */ }
  }
  return { count, joined, position };
}

export function buildJoinTx(referrer?: string | null): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${WAITLIST_PKG}::waitlist::join`,
    arguments: [tx.object(WAITLIST_ID), tx.pure.address(referrer && referrer !== ZERO ? referrer : ZERO), tx.object(CLOCK_ID)],
  });
  return tx;
}

// Top tier of the line = "Founders" (first access at the real-money mainnet launch + badge).
export const FOUNDER_CUTOFF = 100;

export interface WaitlistEntry {
  address: string;
  joinPosition: number;     // raw on-chain join order (FIFO)
  referrals: number;        // signed joins that named this address as referrer
  rank: number;             // EFFECTIVE rank — referrals climb the line
  tier: 'Founder' | 'Early';
}

export interface WaitlistLeaderboard {
  total: number;
  entries: WaitlistEntry[]; // sorted by effective rank
  me: WaitlistEntry | null; // the connected address's standing, if joined
}

/**
 * The referral-weighted line, derived entirely from on-chain `Joined` events (each
 * records `who` + `referrer` + join `position`). Effective rank = referrals DESC, then
 * earlier join ASC — so a signed referral literally moves you up. No contract change:
 * the chain records the raw facts; the ranking is computed from them and verifiable.
 */
export async function fetchWaitlistLeaderboard(address?: string | null): Promise<WaitlistLeaderboard> {
  // Sui GraphQL caps page size at 50 — requesting more throws "page size exceeded".
  // The waitlist is small; 50 covers it (paginate if it ever grows past that).
  const ev = await readClient.queryEvents({ query: { MoveEventType: `${WAITLIST_PKG}::waitlist::Joined` }, limit: 50 });
  const joins = (ev.data ?? [])
    .map((e: { parsedJson?: unknown }) => e.parsedJson as { who?: string; referrer?: string; position?: string | number } | undefined)
    .filter((j): j is { who: string; referrer: string; position: string | number } => !!j && !!j.who);

  const byAddr = new Map<string, { joinPosition: number; referrals: number }>();
  const refCount = new Map<string, number>();
  for (const j of joins) {
    const who = String(j.who).toLowerCase();
    if (!byAddr.has(who)) byAddr.set(who, { joinPosition: Number(j.position ?? byAddr.size + 1), referrals: 0 });
    const ref = String(j.referrer ?? ZERO).toLowerCase();
    if (ref && ref !== ZERO.toLowerCase() && ref !== who) refCount.set(ref, (refCount.get(ref) ?? 0) + 1);
  }
  for (const [addr, c] of refCount) { const e = byAddr.get(addr); if (e) e.referrals = c; }

  const entries: WaitlistEntry[] = [...byAddr.entries()]
    .map(([a, v]) => ({ address: a, joinPosition: v.joinPosition, referrals: v.referrals }))
    .sort((x, y) => (y.referrals - x.referrals) || (x.joinPosition - y.joinPosition))
    .map((e, i) => ({ ...e, rank: i + 1, tier: i < FOUNDER_CUTOFF ? 'Founder' : 'Early' }));

  const me = address ? entries.find((e) => e.address === address.toLowerCase()) ?? null : null;
  return { total: entries.length, entries, me };
}
