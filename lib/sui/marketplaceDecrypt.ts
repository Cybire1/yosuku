// Client-side Seal decryption of a purchased playbook.
// Works natively now that the app is on @mysten/sui 2.x (Seal needs the 2.x
// core client). The buyer signs a session-key challenge with their wallet; the
// Seal key servers dry-run the on-chain `seal_approve` gate and release keys
// only if this wallet has paid. The strategist's edge never touches a server.
import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { DUSDC_TYPE, CLOCK_ID } from './constants';
import { MARKET_PKG, WALRUS_AGGREGATOR, u256ToBlobId, type Listing } from './marketplace';

// Mysten testnet open key servers (per Seal docs).
const KEY_SERVERS = [
  { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
  { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 },
];

interface Playbook {
  lessons?: Array<string | { rule?: string; taughtBy?: string }>;
}

export async function decryptPlaybook(opts: {
  listing: Listing;
  address: string;
  suiClient: SuiJsonRpcClient;
  signPersonalMessage: (message: Uint8Array) => Promise<{ signature: string }>;
}): Promise<string[]> {
  const { listing, address, suiClient, signPersonalMessage } = opts;
  if (listing.playbookBlobId === '0') throw new Error('This playbook has no encrypted content yet.');

  // 1. fetch the ciphertext from Walrus
  const blobId = u256ToBlobId(listing.playbookBlobId);
  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error('Could not load the encrypted playbook from Walrus.');
  const cipher = new Uint8Array(await res.arrayBuffer());

  // 2. session key, authorized by the buyer's wallet signature
  const sessionKey = await SessionKey.create({ address, packageId: MARKET_PKG, ttlMin: 10, suiClient });
  const { signature } = await signPersonalMessage(sessionKey.getPersonalMessage());
  await sessionKey.setPersonalMessageSignature(signature);

  // 3. the seal_approve gate (identity = the listing object id)
  const idHex = listing.id.slice(2);
  const tx = new Transaction();
  tx.moveCall({
    target: `${MARKET_PKG}::strategy_market::seal_approve`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.pure.vector('u8', Array.from(fromHex(idHex))), tx.object(listing.id), tx.object(CLOCK_ID)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  // 4. decrypt (key servers enforce the gate)
  const sealClient = new SealClient({ suiClient, serverConfigs: KEY_SERVERS });
  const plain = await sealClient.decrypt({ data: cipher, sessionKey, txBytes });

  const playbook = JSON.parse(new TextDecoder().decode(plain)) as Playbook;
  return (playbook.lessons ?? []).map((l) =>
    typeof l === 'string' ? l : l.rule ?? JSON.stringify(l),
  );
}
