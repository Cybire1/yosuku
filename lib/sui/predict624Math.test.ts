import { describe, expect, it } from 'vitest';
import {
  POSITION_LOT_MICRO_624,
  positionQuantityMicro624,
  quantizePositionQuantity624,
} from './predict624Math';

describe('Predict v2 quantity lots', () => {
  it('rounds stake-derived quantities to the nearest 0.01 DUSDC lot', () => {
    expect(quantizePositionQuantity624(2 / 0.55)).toBe(3.64);
    expect(positionQuantityMicro624(2 / 0.55)).toBe(3_640_000n);
  });

  it('always returns quantities accepted by order::assert_valid_quantity', () => {
    for (const quantity of [0.006, 1, 3.636364, 9.225]) {
      const micro = positionQuantityMicro624(quantity);
      expect(micro).toBeGreaterThan(0n);
      expect(micro % POSITION_LOT_MICRO_624).toBe(0n);
    }
  });

  it('keeps an empty quantity empty', () => {
    expect(positionQuantityMicro624(0)).toBe(0n);
    expect(positionQuantityMicro624(Number.NaN)).toBe(0n);
  });
});
