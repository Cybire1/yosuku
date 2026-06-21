import { describe, it, expect } from 'vitest';
import {
  RawOracleSchema,
  RawPriceSchema,
  RawPositionSchema,
  QuoteSchema,
  parseList,
  parseOne,
} from './schemas';

// These guard the bet / claim / cashout path: every integer field below is fed straight
// into BigInt(), which throws on a non-integer / NaN. The point of the suite is that bad
// server data is rejected at the boundary, never reaching BigInt().

describe('RawOracleSchema (bet path)', () => {
  const good = { oracle_id: '0xabc', expiry: 1781955000000, min_strike: 1000, tick_size: 100, status: 'active' };

  it('accepts a valid oracle and keeps expiry BigInt-safe', () => {
    const o = parseOne(RawOracleSchema, good, 'o');
    expect(o).not.toBeNull();
    expect(Number.isInteger(o!.expiry)).toBe(true);
    expect(() => BigInt(o!.expiry)).not.toThrow();
  });

  it('coerces numeric strings (the server sometimes sends strings)', () => {
    const o = parseOne(RawOracleSchema, { ...good, expiry: '1781955000000', min_strike: '1000' }, 'o');
    expect(o?.expiry).toBe(1781955000000);
    expect(o?.min_strike).toBe(1000);
  });

  it('drops records with a non-numeric / null expiry instead of crashing the list', () => {
    const list = parseList(
      RawOracleSchema,
      [
        good,
        { ...good, oracle_id: '0xbad', expiry: 'not-a-number' },
        { ...good, oracle_id: '0xnull', expiry: null },
        { ...good, oracle_id: '0xnan', tick_size: NaN },
      ],
      'oracles',
    );
    expect(list).toHaveLength(1);
    expect(list[0].oracle_id).toBe('0xabc');
  });
});

describe('QuoteSchema (the spend cap)', () => {
  it('accepts a sane quote', () => {
    expect(parseOne(QuoteSchema, { mintCost: 0.51, redeemPayout: 0.49 }, 'q')).not.toBeNull();
  });
  it('rejects NaN / negative / null cost (a bad spend cap is dangerous)', () => {
    expect(parseOne(QuoteSchema, { mintCost: 'abc', redeemPayout: 1 }, 'q')).toBeNull();
    expect(parseOne(QuoteSchema, { mintCost: -5, redeemPayout: 1 }, 'q')).toBeNull();
    expect(parseOne(QuoteSchema, { mintCost: null, redeemPayout: 1 }, 'q')).toBeNull();
  });
});

describe('RawPositionSchema (claim / cashout path)', () => {
  const pos = { oracle_id: '0xabc', expiry: 1, strike: 63608000000000, is_up: true, quantity: 5000000 };

  it('keeps strike + quantity BigInt-safe', () => {
    const p = parseOne(RawPositionSchema, pos, 'p');
    expect(p).not.toBeNull();
    expect(() => BigInt(p!.quantity)).not.toThrow();
    expect(() => BigInt(p!.strike)).not.toThrow();
  });

  it('rejects a NaN / missing quantity (would BigInt-crash a claim)', () => {
    expect(parseOne(RawPositionSchema, { ...pos, quantity: NaN }, 'p')).toBeNull();
    expect(parseOne(RawPositionSchema, { ...pos, quantity: undefined }, 'p')).toBeNull();
  });
});

describe('RawPriceSchema (pricing)', () => {
  it('accepts a finite spot/forward, rejects non-finite', () => {
    expect(parseOne(RawPriceSchema, { oracle_id: '0xabc', spot: 63000, forward: 63010 }, 'pr')).not.toBeNull();
    expect(parseOne(RawPriceSchema, { oracle_id: '0xabc', spot: 'x', forward: 1 }, 'pr')).toBeNull();
    expect(parseOne(RawPriceSchema, { oracle_id: '0xabc', spot: null, forward: 1 }, 'pr')).toBeNull();
  });
});

describe('parseList resilience', () => {
  it('returns [] for non-array input', () => {
    expect(parseList(RawOracleSchema, { not: 'an array' }, 'x')).toEqual([]);
    expect(parseList(RawOracleSchema, null, 'x')).toEqual([]);
  });
});
