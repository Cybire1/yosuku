// PTB builders + readers for the yolev UNDERWRITING vault.
//
// The reserve is the counterparty: a trader posts margin, the reserve fronts the
// rest of the notional and charges a premium up front, and the trader mints a
// Predict position with the combined notional — all in one PTB. The trader has no
// debt (max loss = margin); on close, `settle` reclaims the reserve's fronted
// capital from the redeemed proceeds and returns the remainder.
import { Transaction } from '@mysten/sui/transactions';
import {
  YOLEV_PACKAGE,
  RESERVE_ID,
  DUSDC_TYPE,
  CLOCK_ID,
  DUSDC_MULTIPLIER,
} from './constants';

const BPS = 10_000;

function mergedPrimary(tx: Transaction, coinIds: string[]) {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

/** LP: supply DUSDC to the reserve, receive a SupplyPosition. */
export function supplyTx(coinIds: string[], amount: bigint, owner: string): Transaction {
  const tx = new Transaction();
  const [c] = tx.splitCoins(mergedPrimary(tx, coinIds), [amount]);
  const sp = tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(RESERVE_ID), c],
  });
  tx.transferObjects([sp], tx.pure.address(owner));
  return tx;
}

/** LP: redeem a SupplyPosition for principal + earned premiums. */
export function withdrawTx(positionId: string, owner: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(RESERVE_ID), tx.object(positionId)],
  });
  tx.transferObjects([coin], tx.pure.address(owner));
  return tx;
}

// ── leverage open = escrow → fill (trustless custody) ──
// The trader only ESCROWS margin here; the keeper executes the open into the
// protocol-owned custody manager (it's the only address that can deposit/mint
// there). The trader can `cancel` an unfilled order to get their margin back.

/** Trader: escrow margin for a leveraged BINARY position. The keeper fills it. */
export function requestOpenBinaryTx(p: {
  coinIds: string[];
  marginAmount: bigint;
  leverageBps: number;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
}): Transaction {
  const tx = new Transaction();
  const [margin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.marginAmount]);
  tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::request_open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(RESERVE_ID), margin, tx.pure.u64(p.leverageBps),
      tx.pure.id(p.oracleId), tx.pure.u64(p.expiry),
      tx.pure.bool(false), tx.pure.u64(p.strike), tx.pure.u64(BigInt(0)), tx.pure.bool(p.isUp),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/** Trader: escrow margin for a leveraged RANGE position. The keeper fills it. */
export function requestOpenRangeTx(p: {
  coinIds: string[];
  marginAmount: bigint;
  leverageBps: number;
  oracleId: string;
  expiry: bigint;
  lower: bigint;
  higher: bigint;
}): Transaction {
  const tx = new Transaction();
  const [margin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.marginAmount]);
  tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::request_open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(RESERVE_ID), margin, tx.pure.u64(p.leverageBps),
      tx.pure.id(p.oracleId), tx.pure.u64(p.expiry),
      tx.pure.bool(true), tx.pure.u64(p.lower), tx.pure.u64(p.higher), tx.pure.bool(false),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/** Trader: reclaim an unfilled order's escrowed margin. */
export function cancelOrderTx(orderId: string, owner: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::cancel`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(RESERVE_ID), tx.object(orderId)],
  });
  tx.transferObjects([coin], tx.pure.address(owner));
  return tx;
}

/** A pending escrowed open order. */
export interface OrderData {
  id: string;
  trader: string;
  margin: number;     // DUSDC
  leverage: number;   // leverageBps / 10000
  oracleId: string;
  isRange: boolean;
}

/** The underwritten position record stored on-chain (a shared object). */
export interface PositionData {
  id: string;
  owner: string;
  margin: number;     // DUSDC
  fronted: number;    // DUSDC the reserve put up
  premium: number;    // DUSDC paid to the reserve
  notional: number;   // DUSDC deployed into the Predict position
  leverage: number;   // (margin + fronted) / margin
  managerId: string;
  oracleId: string;
  expiry: bigint;
  isRange: boolean;
  lowerStrike: bigint;
  higherStrike: bigint;
  isUp: boolean;
  quantity: bigint;
}

// ─── read: reserve stats ───
export interface ReserveStats {
  liquid: number;       // idle DUSDC (withdrawable)
  outstanding: number;  // DUSDC fronted into open positions
  totalValue: number;   // liquid + outstanding
  utilizationBps: number;
  premiumBps: number;
  maxLeverageBps: number;
  maxExposureBps: number;
  supplyShares: number; // raw
}

interface ReserveFields {
  liquid: string;
  outstanding: string;
  supply_shares: string;
  premium_bps: string;
  max_leverage_bps: string;
  max_exposure_bps: string;
}

export function computeReserveStats(fields: ReserveFields): ReserveStats {
  const liquid = Number(fields.liquid);
  const outstanding = Number(fields.outstanding);
  const totalValue = liquid + outstanding;
  const utilizationBps = totalValue > 0 ? Math.round((outstanding / totalValue) * BPS) : 0;
  return {
    liquid: liquid / DUSDC_MULTIPLIER,
    outstanding: outstanding / DUSDC_MULTIPLIER,
    totalValue: totalValue / DUSDC_MULTIPLIER,
    utilizationBps,
    premiumBps: Number(fields.premium_bps),
    maxLeverageBps: Number(fields.max_leverage_bps),
    maxExposureBps: Number(fields.max_exposure_bps),
    supplyShares: Number(fields.supply_shares),
  };
}

/** Value (DUSDC) of a SupplyPosition given its shares and the reserve stats. */
export function supplyPositionValue(shares: number, stats: ReserveStats): number {
  if (stats.supplyShares === 0) return 0;
  return (shares * stats.totalValue) / stats.supplyShares;
}

export const SUPPLY_POSITION_TYPE = `${YOLEV_PACKAGE}::underwrite::SupplyPosition`;
export const POSITION_TYPE = `${YOLEV_PACKAGE}::underwrite::Position<${DUSDC_TYPE}>`;
export const ORDER_REQUESTED_EVENT = `${YOLEV_PACKAGE}::underwrite::OrderRequested`;
export const ORDER_FILLED_EVENT = `${YOLEV_PACKAGE}::underwrite::OrderFilled`;
