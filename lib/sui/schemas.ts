// Runtime validation for untrusted predict-server / RPC responses on the money path.
//
// The bet / claim / cashout flows feed these fields straight into BigInt() and Number().
// A missing or non-numeric field from the server used to throw a raw `Cannot convert … to
// a BigInt` / `BigInt(NaN)` and take down the whole flow. These schemas coerce + validate
// at the fetch boundary, so a bad record is dropped (not crashed) and the integer fields
// reaching BigInt() are guaranteed safe.
import { z } from 'zod';

// The server returns some numbers as strings, so coerce. `.int()` is required on every
// field that later becomes a BigInt — BigInt() throws on a non-integer number. Treat
// null / undefined / '' as missing (→ NaN) so a required field FAILS instead of silently
// coercing to 0 (z.coerce.number(null) would be 0).
const nullish = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : v);
const intField = z.preprocess(nullish, z.coerce.number().int());
const numField = z.preprocess(nullish, z.coerce.number().finite());

export const RawOracleSchema = z
  .object({
    oracle_id: z.string().min(1),
    predict_id: z.string().catch(''),
    oracle_cap_id: z.string().catch(''),
    underlying_asset: z.string().catch('BTC'),
    expiry: intField,
    min_strike: intField,
    tick_size: intField,
    status: z.enum(['active', 'settled', 'inactive', 'pending_settlement']).catch('inactive'),
    activated_at: numField.catch(0),
    settlement_price: numField.nullable().catch(null),
    settled_at: numField.nullable().catch(null),
    created_checkpoint: numField.catch(0),
  })
  .passthrough();

export const RawPriceSchema = z
  .object({
    oracle_id: z.string().min(1),
    spot: numField,
    forward: numField,
    onchain_timestamp: numField.catch(0),
  })
  .passthrough();

export const RawPositionSchema = z
  .object({
    oracle_id: z.string().min(1),
    expiry: intField,
    strike: intField,
    is_up: z.coerce.boolean(),
    quantity: intField,
    cost: numField.optional(),
    ask_price: numField.optional(),
    payout: numField.optional(),
    bid_price: numField.optional(),
  })
  .passthrough();

export const TradeSchema = z
  .object({
    type: z.enum(['mint', 'redeem']),
    oracle_id: z.string(),
    manager_id: z.string().catch(''),
    strike: numField.catch(0),
    is_up: z.coerce.boolean().catch(true),
    quantity: numField,
    cost: numField.optional(),
    payout: numField.optional(),
    ask_price: numField.optional(),
    bid_price: numField.optional(),
    checkpoint_timestamp_ms: numField.catch(0),
  })
  .passthrough();

// The on-chain cost quote — feeds maxCost / the bet's spend cap. Must be finite & >= 0.
export const QuoteSchema = z
  .object({
    mintCost: z.preprocess(nullish, z.coerce.number().finite().nonnegative()),
    redeemPayout: z.preprocess(nullish, z.coerce.number().finite().nonnegative()),
  })
  .passthrough();

/** Validate an array, dropping invalid elements so one bad record never nukes the list. */
export function parseList<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  label: string,
): z.infer<S>[] {
  if (!Array.isArray(raw)) return [];
  const out: z.infer<S>[] = [];
  let dropped = 0;
  for (const item of raw) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else dropped++;
  }
  if (dropped) console.warn(`[schema] ${label}: dropped ${dropped}/${raw.length} invalid record(s)`);
  return out;
}

/** Validate a single object; null (not a crash) on failure. */
export function parseOne<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  label: string,
): z.infer<S> | null {
  const r = schema.safeParse(raw);
  if (!r.success) {
    console.warn(`[schema] ${label}: invalid —`, r.error.issues?.[0]?.message ?? 'parse failed');
    return null;
  }
  return r.data;
}
