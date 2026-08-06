// Authoritative settlement read for a market, server-side.
//
// DO NOT use `strike_exposure.settlement_price` off the object to decide whether a market has
// settled: a LIVE market carries a non-zero value there too (it tracks spot), so reading it
// early gives a confident, wrong answer. `try_settlement_price` returns an Option — none while
// the market is live — which is the only signal that distinguishes the two.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { PREDICT624 } from './predict624Client';

const GRPC_URL = 'https://fullnode.testnet.sui.io:443';
// Any address works: this is a read-only simulation, nothing is signed or submitted.
const PROBE_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000001';

const client = () => new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL }) as unknown as { simulateTransaction: (a: unknown) => Promise<unknown> };

function decodeU64LE(bytes: Uint8Array): bigint {
  let v = 0n;
  bytes.forEach((b, i) => { v |= BigInt(b) << (8n * BigInt(i)); });
  return v;
}

/**
 * Settlement price in RAW units (USD × 1e9), or null while the market is still live.
 * Option<u64> BCS: leading 0x00 = none; 0x01 followed by the LE u64 = some.
 */
export async function readSettlementPrice(marketId: string): Promise<bigint | null> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PREDICT624.predictPackage}::expiry_market::try_settlement_price`,
      arguments: [tx.object(marketId)],
    });
    tx.setSender(PROBE_SENDER);

    // Pass the Transaction itself and ask for commandResults, exactly as the relay does.
    // Building first and handing over bytes yields a response with no return values.
    const res = await client().simulateTransaction({
      transaction: tx,
      include: { commandResults: true },
    } as never) as { commandResults?: Array<{ returnValues?: Array<{ bcs?: Uint8Array | string }> }> };
    const rv = res.commandResults?.at(-1)?.returnValues ?? [];
    const raw = rv[0]?.bcs as Uint8Array | string | undefined;
    if (!raw) return null;
    const b = typeof raw === 'string' ? Uint8Array.from(Buffer.from(raw, 'base64')) : Uint8Array.from(raw);
    if (!b.length || b[0] === 0) return null; // none → still live
    return decodeU64LE(b.subarray(1));
  } catch {
    return null;
  }
}

/**
 * Did a position win? Ticks are absolute indices; the raw strike is `tick * tick_size`, which is
 * the same unit the settlement price is quoted in. Upper bound is exclusive, and the +inf
 * sentinel means there is no upper bound at all.
 */
export function isWinningRange(
  settlementRaw: bigint,
  lowerTick: bigint,
  higherTick: bigint,
  tickSize: bigint,
  posInfTick: bigint,
): boolean {
  const lowerRaw = lowerTick * tickSize;
  const aboveLower = settlementRaw >= lowerRaw;
  if (higherTick >= posInfTick) return aboveLower;
  return aboveLower && settlementRaw < higherTick * tickSize;
}
