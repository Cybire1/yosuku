// BTC spot read straight off the PythFeed object, server-side.
//
// Why this exists: propbook (the oracle HTTP indexer) serves the 6-24 deployment only. For the
// 7-29 feed it answers 200 OK with an empty array — no error, no failed request, just nothing.
// That is the worst possible failure shape, because every caller's try/catch sails straight past
// it and the UI simply renders blanks forever. It is exactly how the markets page lost its spot,
// its strike and its odds after the migration.
//
// Reading the object is also the more honest number: it is the value the market prices and
// settles against, with no indexer hop in between.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { PREDICT624 } from './predict624Client';

const GRPC_URL = 'https://fullnode.testnet.sui.io:443';

/** protobuf Struct → plain JS. gRPC returns Move contents as Value wrappers. */
type PbValue = { kind?: { oneofKind?: string; [k: string]: unknown } };
function unwrap(v: PbValue | undefined): unknown {
  const k = v?.kind;
  if (!k) return undefined;
  switch (k.oneofKind) {
    case 'stringValue': return k.stringValue;
    case 'numberValue': return k.numberValue;
    case 'boolValue': return k.boolValue;
    case 'structValue': {
      const out: Record<string, unknown> = {};
      const fields = (k.structValue as { fields?: Record<string, PbValue> })?.fields ?? {};
      for (const [a, b] of Object.entries(fields)) out[a] = unwrap(b);
      return out;
    }
    default: return undefined;
  }
}

export interface SpotReading {
  usd: number;
  /** Oracle's own source timestamp, not our clock — this is when the price was observed. */
  tsMs: number;
}

export async function readOnchainSpot(): Promise<SpotReading | null> {
  try {
    const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });
    const res = await client.ledgerService.getObject({
      objectId: PREDICT624.pythFeed,
      readMask: { paths: ['json'] },
    });
    const root = unwrap(res.response?.object?.json as PbValue | undefined) as
      | { lane?: { latest?: { value?: Record<string, unknown>; source_timestamp_ms?: string } } }
      | undefined;
    const latest = root?.lane?.latest;
    const v = latest?.value;
    if (!v) return null;

    const exp = Number(v.exponent_magnitude);
    const scale = v.exponent_is_negative === false ? 10 ** exp : 10 ** -exp;
    const usd = Number(v.price_magnitude) * scale * (v.price_is_negative ? -1 : 1);
    if (!Number.isFinite(usd) || usd <= 0) return null;

    const tsMs = Number(latest?.source_timestamp_ms);
    return { usd, tsMs: Number.isFinite(tsMs) && tsMs > 0 ? tsMs : Date.now() };
  } catch {
    return null;
  }
}
