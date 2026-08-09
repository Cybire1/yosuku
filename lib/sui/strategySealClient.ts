// Seal the strategy playbook, and let the people who paid for it read it.
//
// `yolev::strategy` stores a `capsule_blob` (a Seal-encrypted playbook on Walrus) but ships no
// `seal_approve`, so until now a subscriber paid the fee and received bytes that no key server
// would ever unlock. The gate lives in its own package because yolev cannot be upgraded from its
// own source: a compatibility check against the deployed lineage returns 58 errors. Everything
// the policy needs was already deployed and public, so it reads the live shared objects from
// outside instead.
//
// Gate: yosuku_strategy_seal @ 0x7ecf2f9e… (published 2026-08-08, tx 4cLwK4dY…)
//
// Identity is `[package_id][bcs(strategy_id)]`. The SDK prepends the package id itself, so
// callers pass ONLY the 32 strategy-id bytes and the on-chain check is a suffix match. Encrypt
// with an equality-shaped identity and it will pass every unit test and then fail against a real
// key server.

import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex, toBase64, fromBase64 } from '@mysten/sui/utils';
import { grpc } from './modernClients';

/** The published gate. Seal derives the key namespace from THIS id, so re-publishing the policy
 *  orphans every capsule encrypted under the old one. Treat it as permanent. */
export const STRATEGY_SEAL_PKG =
  '0x7ecf2f9e309d30384ce4b737d457ee1057e656b77c7cc1aba1a5e921ab65ae4c';

/** Same two testnet key servers the memory market already decrypts against in-browser. */
const SEAL_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];

const WALRUS_AGG = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';
const WALRUS_PUB = 'https://publisher.walrus-testnet.walrus.space/v1/blobs';

type SignPersonalMessage = (a: { message: Uint8Array }) => Promise<{ signature: string }>;

const sealClient = () =>
  new SealClient({
    suiClient: grpc,
    serverConfigs: SEAL_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
    verifyKeyServers: false,
  });

/** The identity a capsule is encrypted under: the raw 32-byte strategy id.
 *  `encrypt` takes it as hex, the policy call takes it as bytes, so both forms are exported
 *  from one place rather than being re-derived (and eventually diverging) at each call site. */
export function strategyIdentityHex(strategyId: string): string {
  return strategyId.replace(/^0x/, '');
}
export function strategyIdentity(strategyId: string): Uint8Array {
  return fromHex(strategyIdentityHex(strategyId));
}

/**
 * Creator: encrypt a playbook for a strategy and put it on Walrus.
 *
 * Returns the blob id to store on the `Strategy` via `update_strategy`. Encryption is the
 * creator's own act, so nothing readable ever reaches our servers or Walrus.
 */
export async function sealPlaybook(opts: {
  strategyId: string;
  playbook: string;
}): Promise<{ blobId: string; bytes: number }> {
  const { strategyId, playbook } = opts;
  if (!playbook.trim()) throw new Error('The playbook is empty.');

  const { encryptedObject } = await sealClient().encrypt({
    threshold: 1,
    packageId: STRATEGY_SEAL_PKG,
    id: strategyIdentityHex(strategyId),
    data: new TextEncoder().encode(playbook),
  });

  // 5 epochs: long enough to outlive a subscription cycle on testnet. A capsule whose blob has
  // expired is indistinguishable from one that never existed, so this wants renewing, not
  // setting once and forgetting.
  const res = await fetch(`${WALRUS_PUB}?epochs=5`, { method: 'PUT', body: encryptedObject });
  if (!res.ok) throw new Error(`Walrus refused the capsule (${res.status}).`);
  const json = (await res.json()) as {
    newlyCreated?: { blobObject?: { blobId?: string } };
    alreadyCertified?: { blobId?: string };
  };
  const blobId = json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId;
  if (!blobId) throw new Error('Walrus returned no blob id.');
  return { blobId, bytes: encryptedObject.length };
}

/**
 * Subscriber: decrypt the playbook you paid for.
 *
 * The key server dry-runs `seal_approve` and only releases a share if it does not abort, so the
 * four assertions in the gate ARE the paywall. `Subscription` is a SHARED object, which is why
 * the policy checks `subscriber == sender` rather than trusting possession, and why this passes
 * the real sender rather than building kind-only.
 */
export async function readPlaybook(opts: {
  walletAddress: string;
  strategyId: string;
  subscriptionId: string;
  blobId: string;
  /** The quote asset type arg of the Strategy<T> being read. */
  coinType: string;
  signPersonalMessage: SignPersonalMessage;
}): Promise<string> {
  const { walletAddress, strategyId, subscriptionId, blobId, coinType, signPersonalMessage } = opts;

  const r = await fetch(`${WALRUS_AGG}/${blobId}`);
  if (!r.ok) throw new Error(`Couldn't fetch the playbook from Walrus (${r.status}).`);
  const ct = new Uint8Array(await r.arrayBuffer());

  const sessionKey = await SessionKey.create({
    address: walletAddress,
    packageId: STRATEGY_SEAL_PKG,
    ttlMin: 10,
    suiClient: grpc,
  });
  const { signature } = await signPersonalMessage({ message: sessionKey.getPersonalMessage() });
  await sessionKey.setPersonalMessageSignature(signature);

  const tx = new Transaction();
  tx.setSender(walletAddress); // the policy reads ctx.sender(); a kind-only build has none
  tx.moveCall({
    target: `${STRATEGY_SEAL_PKG}::strategy_seal::seal_approve`,
    typeArguments: [coinType],
    arguments: [
      tx.pure.vector('u8', Array.from(strategyIdentity(strategyId))),
      tx.object(strategyId),
      tx.object(subscriptionId),
    ],
  });
  const txBytes = await tx.build({ client: grpc, onlyTransactionKind: true });

  try {
    const dec = await sealClient().decrypt({ data: ct, sessionKey, txBytes });
    return new TextDecoder().decode(dec);
  } catch (e) {
    // The abort codes are the product's own language, so translate them instead of leaking
    // "MoveAbort 2" to somebody who just paid a subscription fee.
    const m = String(e instanceof Error ? e.message : e);
    if (/abort.*\b1\b/.test(m)) throw new Error('This subscription belongs to a different wallet.');
    if (/abort.*\b2\b/.test(m)) throw new Error('This subscription was cancelled, so the playbook is closed.');
    if (/abort.*\b3\b/.test(m)) throw new Error('That subscription is for a different strategy.');
    if (/abort.*\b4\b/.test(m)) throw new Error('This playbook was sealed for a different strategy.');
    throw new Error(`Couldn't open the playbook: ${m}`);
  }
}

/** Creator: read your own playbook back. Creators hold no subscription to themselves. */
export async function readOwnPlaybook(opts: {
  walletAddress: string;
  strategyId: string;
  blobId: string;
  coinType: string;
  signPersonalMessage: SignPersonalMessage;
}): Promise<string> {
  const { walletAddress, strategyId, blobId, coinType, signPersonalMessage } = opts;
  const r = await fetch(`${WALRUS_AGG}/${blobId}`);
  if (!r.ok) throw new Error(`Couldn't fetch the playbook from Walrus (${r.status}).`);
  const ct = new Uint8Array(await r.arrayBuffer());

  const sessionKey = await SessionKey.create({
    address: walletAddress, packageId: STRATEGY_SEAL_PKG, ttlMin: 10, suiClient: grpc,
  });
  const { signature } = await signPersonalMessage({ message: sessionKey.getPersonalMessage() });
  await sessionKey.setPersonalMessageSignature(signature);

  const tx = new Transaction();
  tx.setSender(walletAddress);
  tx.moveCall({
    target: `${STRATEGY_SEAL_PKG}::strategy_seal::seal_approve_creator`,
    typeArguments: [coinType],
    arguments: [
      tx.pure.vector('u8', Array.from(strategyIdentity(strategyId))),
      tx.object(strategyId),
    ],
  });
  const txBytes = await tx.build({ client: grpc, onlyTransactionKind: true });
  const dec = await sealClient().decrypt({ data: ct, sessionKey, txBytes });
  return new TextDecoder().decode(dec);
}


// ── blob id <-> u256 ──
//
// `Strategy.capsule_blob` is a u256 on chain; Walrus hands back a base64url string. Both are the
// same 32 bytes, so they convert cleanly, but nothing did that conversion until now — which is
// why the memory market carried a hardcoded listing-to-blob map instead of reading the chain.

const b64url = (b: Uint8Array) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** u256 decimal string (as stored on the Strategy) -> Walrus blob id. "0" means none. */
export function blobIdFromU256(dec: string): string | null {
  if (!dec || dec === '0') return null;
  let v = BigInt(dec);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return b64url(out);
}

/** Walrus blob id -> u256, for writing back via update_strategy. */
export function u256FromBlobId(blobId: string): bigint {
  const pad = blobId.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = fromBase64(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}
