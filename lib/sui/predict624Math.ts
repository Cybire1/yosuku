const DUSDC_MICRO = 1_000_000;

/** Predict v2 encodes position quantities in 0.01 DUSDC lots. */
export const POSITION_LOT_MICRO_624 = 10_000n;

/** Convert a display-unit payout quantity into the nearest valid on-chain lot. */
export function positionQuantityMicro624(quantityDusdc: number): bigint {
  if (!Number.isFinite(quantityDusdc) || quantityDusdc <= 0) return 0n;
  const rawMicro = BigInt(Math.round(quantityDusdc * DUSDC_MICRO));
  const rounded =
    ((rawMicro + POSITION_LOT_MICRO_624 / 2n) / POSITION_LOT_MICRO_624)
    * POSITION_LOT_MICRO_624;
  return rounded > 0n ? rounded : POSITION_LOT_MICRO_624;
}

/** Display-unit twin of positionQuantityMicro624, used by stake-first UI math. */
export function quantizePositionQuantity624(quantityDusdc: number): number {
  return Number(positionQuantityMicro624(quantityDusdc)) / DUSDC_MICRO;
}
