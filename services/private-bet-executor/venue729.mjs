// The private desk on DeepBook Predict 7-29.
//
// Replaces venue624.mjs, which was written against a venue that had already been retired by the
// time it was finished. Every signature below was read off the deployed package rather than
// carried over, because 7-29 changed three things that fail silently if assumed:
//
//   * load_live_pricer takes SEVEN args, not eight. 6-24's separate BS spot and forward feeds
//     collapsed into one BlockScholesValueStore.
//   * mint_exact_amount gained a SIXTH u64, `max_cost`, appended after `leverage`. Passing five
//     produces an ArityMismatch that never reaches chain logic, which is what made every price
//     on the board render as a dash.
//   * redeem_settled_permissionless exists and needs NO Auth. It takes the AccountRegistry
//     instead, so a settled position can be redeemed even if the desk key has rotated. That is
//     the one to use: proceeds land in the account either way, and it removes a dependency on
//     holding a key at settlement time.
//
// A position is identified by `orderId`, a packed u256 from OrderMinted. That is 32 bytes, the
// exact width of the enclave ticket's `session_manager` field, so the enclave, the Move package
// and the claim format carry over from 4-16 untouched. Only these calls are new.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';

export const P729 = {
  predictPackage: '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb',
  accountPackage: '0xbdbb60b00f2d4f30daeff62f2c642b18433a8fcdfbebccc808df578df2a0c203',
  protocolConfig: '0x43703ceee4d5f5a9e8cbf728071c34dc65961dd6e878fafd9ac36d86a9a4ce5b',
  accountRegistry: '0x21a7ed28397363b5550853c1f08795731257de81028cd1bf87f20c0752c8ca2f',
  oracleRegistry: '0xc1dffc5f7a5404cb002ba3bd7c50d6a2dbe8bb6afd40080cd663965deff9d577',
  pythFeed: '0xccafaa6c5a41f0493585cf268f2b4dc14c91ed798362444144cac2c745db8dde',
  bsValuesFeed: '0x6d9de17954f4c1a2f01fdd97c0bb8a2e682c1fea0f8f048dcd127d543a6ac051',
  bsSviFeed: '0x83c2d6307fd3591228052fc0d24c4f00a698b0eb4fef5e6083a213ca0d54bd35',
  accumulatorRoot: '0x0000000000000000000000000000000000000000000000000000000000000acc',
  clock: '0x6',
  dusdcType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  orderMintedEventType:
    '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb::order_events::OrderMinted',
};

export const NEG_INF_TICK = 0n;
export const POS_INF_TICK = 18_446_744_073_709_551_615n;
export const MAX_U64 = 18_446_744_073_709_551_615n;

/** $1-snapped tick on the $0.01 grid. */
export const usdToTick = (usd) => BigInt(Math.round(Number(usd) * 100));

/** UP is above the strike, DOWN is below it. */
export function ticksForSide(strikeUsd, isUp) {
  const t = usdToTick(strikeUsd);
  return isUp ? { lower: t, higher: POS_INF_TICK } : { lower: NEG_INF_TICK, higher: t };
}

/** The per-PTB pricer. Seven args on 7-29; passing 6-24's eight aborts rather than degrading. */
function appendPricer(tx, marketId) {
  return tx.moveCall({
    target: `${P729.predictPackage}::expiry_market::load_live_pricer`,
    arguments: [
      tx.object(marketId),
      tx.object(P729.protocolConfig),
      tx.object(P729.oracleRegistry),
      tx.object(P729.pythFeed),
      tx.object(P729.bsValuesFeed),
      tx.object(P729.bsSviFeed),
      tx.object(P729.clock),
    ],
  });
}

/** One-time: the desk's canonical account. Aborts on chain if it already exists. */
export function buildCreateDeskAccountTx() {
  const tx = new Transaction();
  const wrapper = tx.moveCall({
    target: `${P729.accountPackage}::account_registry::new`,
    arguments: [tx.object(P729.accountRegistry)],
  });
  tx.moveCall({ target: `${P729.accountPackage}::account::share`, arguments: [wrapper] });
  return tx;
}

/**
 * Fund the desk account and mint the position in one PTB.
 *
 * Two separate Auths on purpose: the hot potato is consumed by the call it authorises, so deposit
 * and mint each need their own. Both come from `generate_auth`, the OWNER path tied to the tx
 * sender. The app-auth variant has no owner check at all and is never used here.
 */
export function buildDeskMintTx({ wrapperId, marketId, strikeUsd, isUp, stakeMicro, maxPremiumMicro, maxCostMicro }) {
  const { lower, higher } = ticksForSide(strikeUsd, isUp);
  const tx = new Transaction();

  const pay = coinWithBalance({ type: P729.dusdcType, balance: BigInt(stakeMicro) });
  const authDeposit = tx.moveCall({ target: `${P729.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${P729.accountPackage}::account::deposit_funds`,
    typeArguments: [P729.dusdcType],
    arguments: [tx.object(wrapperId), authDeposit, pay, tx.object(P729.accumulatorRoot), tx.object(P729.clock)],
  });

  const pricer = appendPricer(tx, marketId);
  const authMint = tx.moveCall({ target: `${P729.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${P729.predictPackage}::expiry_market::mint_exact_amount`,
    arguments: [
      tx.object(marketId), tx.object(wrapperId), authMint, tx.object(P729.protocolConfig), pricer,
      // lower_tick, higher_tick, max_premium, min_quantity, leverage, max_cost
      tx.pure.u64(lower),
      tx.pure.u64(higher),
      tx.pure.u64(BigInt(maxPremiumMicro)),
      tx.pure.u64(0n),               // no slippage floor
      tx.pure.u64(1_000_000_000n),   // 1x
      // A real ceiling, not MAX_U64: this spends the desk's float, and an uncapped mint is how a
      // bad quote turns into a bad fill.
      tx.pure.u64(BigInt(maxCostMicro)),
      tx.object(P729.accumulatorRoot), tx.object(P729.clock),
    ],
  });
  return tx;
}

/**
 * Redeem a settled position, permissionlessly.
 *
 * No Auth and no desk key required, so a settled bet can always be collected even if the signing
 * key has rotated or the enclave has been rebuilt. Proceeds land in the account regardless.
 */
export function buildDeskRedeemTx({ wrapperId, marketId, orderId, qtyMicro }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${P729.predictPackage}::expiry_market::redeem_settled_permissionless`,
    arguments: [
      tx.object(marketId),
      tx.object(P729.accountRegistry),
      tx.object(wrapperId),
      tx.object(P729.protocolConfig),
      tx.pure.u256(BigInt(orderId)),
      tx.pure.u64(BigInt(qtyMicro)),
      tx.object(P729.accumulatorRoot),
      tx.object(P729.clock),
    ],
  });
  return tx;
}

/** Pull the position id out of the mint. Without it there is nothing to put in the ticket. */
export function orderIdFromEvents(events) {
  const ev = (events ?? []).find((e) => String(e.type) === P729.orderMintedEventType);
  if (!ev) return null;
  const j = ev.parsedJson ?? ev.contents?.json ?? {};
  const raw = j.order_id ?? j.orderId ?? j.id;
  return raw == null ? null : BigInt(raw);
}

/** u256 order id as the 32 little-endian bytes the ticket's `session_manager` field carries. */
export function orderIdToBytes32Hex(orderId) {
  let v = BigInt(orderId);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return '0x' + Buffer.from(out).toString('hex');
}

export function bytes32HexToOrderId(hex) {
  const b = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  if (b.length !== 32) throw new Error('order id must be 32 bytes');
  let v = 0n;
  for (let i = 31; i >= 0; i -= 1) v = (v << 8n) | BigInt(b[i]);
  return v;
}
