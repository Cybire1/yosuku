import { describe, expect, it } from 'vitest';
import { publicKeyFromRawBytes } from '@mysten/sui/verify';
import { fromBase64 } from '@mysten/sui/utils';
import { zkLoginPublicIdentifierForAddress } from './creatorRecovery';

const LOGIN = '0x6b3b3e59455ff6e500cfa5405985ed2ff40e0451c81d9921cda9c0a93035d3e1';
// WalletAccount.publicKey from the reproduced Enoki session: 0x05 scheme flag + 60 raw bytes.
const FLAGGED = fromBase64(
  'BRtodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20BT80RSpqXKtSRhAW9fDitlTMn8V61JtFnIAmVhUZBPQ==',
);

describe('zkLoginPublicIdentifierForAddress', () => {
  it('removes the wallet-account scheme flag and preserves the address identity', () => {
    const raw = zkLoginPublicIdentifierForAddress(FLAGGED, LOGIN);
    expect(FLAGGED).toHaveLength(61);
    expect(raw).toHaveLength(60);
    expect([...raw]).toEqual([...FLAGGED.slice(1)]);
    expect(publicKeyFromRawBytes('ZkLogin', raw).verifyAddress(LOGIN)).toBe(true);
  });

  it('also accepts already-raw zkLogin public identifier bytes', () => {
    expect(zkLoginPublicIdentifierForAddress(FLAGGED.slice(1), LOGIN)).toEqual(FLAGGED.slice(1));
  });

  it('fails closed when the public key does not derive the connected address', () => {
    expect(() => zkLoginPublicIdentifierForAddress(FLAGGED, `0x${'1'.repeat(64)}`))
      .toThrow('Google wallet public key does not match the connected address');
  });
});
