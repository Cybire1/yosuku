// On-chain mainnet waitlist — joining is a signed tx by a real wallet (verifiable demand,
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
