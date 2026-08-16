// creatorCode.ts — X Predict creator attribution.
//
// A creator mints ONE BuilderCode owned by their own wallet, posts calls on X, and every bet
// placed off a call carries that code. The builder fee settles to the code's own object address
// and `builder_code::claim_all_builder_fees` asserts `ctx.sender() == code.owner`, so:
//
//   * the creator's cut never passes through Yosuku, and
//   * Yosuku cannot withhold it, delay it, or claw it back.
//
// That is the whole pitch to a creator, and it is enforced by the protocol rather than by us
// being trustworthy.
//
// There is deliberately NO registry table here. Codes are claimed at a DERIVED object address
// from (registry, owner, index), so a creator's code id is a pure function of their wallet. A
// stored handle→code mapping would be a second source of truth that can drift, and it would put
// us back in the middle of something we just took ourselves out of.

import { Transaction } from '@mysten/sui/transactions';
import { PREDICT624 } from './predict624Client';

/** Index 0 is the creator's primary code. Extra indexes exist for anyone wanting to split their
 *  own attribution across campaigns; nothing here needs them yet. */
export const CREATOR_CODE_INDEX = 0n;

/**
 * Mint a creator's BuilderCode. MUST be signed by the creator: `create_and_share` reads
 * `ctx.sender()` as the owner, so whoever signs this owns the fees forever. Yosuku sponsoring
 * the gas is fine; Yosuku signing it is not, because then Yosuku owns the code.
 */
export function buildCreateCreatorCodeTx(index: bigint = CREATOR_CODE_INDEX): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::registry::create_and_share_builder_code`,
    arguments: [tx.object(PREDICT624.registry), tx.object(PREDICT624.protocolConfig), tx.pure.u64(index)],
  });
  return tx;
}

/**
 * Read what a code has earned but not yet claimed, in micro-DUSDC.
 *
 * Worth surfacing to creators directly: it is the number that makes the program real to them,
 * and it is readable by anyone, so they never have to take our word for what they are owed.
 */
export async function claimableFeesMicro(
  client: { devInspectTransactionBlock: (a: { sender: string; transactionBlock: Transaction }) => Promise<unknown> },
  codeId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::builder_code::claimable_builder_fees`,
    arguments: [tx.object(PREDICT624.accumulatorRoot), tx.object(codeId)],
  });
  const res = (await client.devInspectTransactionBlock({
    sender: `0x${'0'.repeat(64)}`,
    transactionBlock: tx,
  })) as { results?: { returnValues?: [number[], string][] }[] };
  const rv = res.results?.[0]?.returnValues?.[0]?.[0];
  if (!rv) return 0n;
  let v = 0n;
  for (let i = rv.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(rv[i]);
  return v;
}

/** Claim everything owed to a code. Only the code's owner can sign this successfully. */
export function buildClaimCreatorFeesTx(codeId: string, to: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${PREDICT624.predictPackage}::builder_code::claim_all_builder_fees`,
    arguments: [tx.object(codeId), tx.object(PREDICT624.accumulatorRoot)],
  });
  tx.transferObjects([coin], to);
  return tx;
}

/**
 * Find a wallet's BuilderCode.
 *
 * Codes are SHARED objects, so `getOwnedObjects` never sees them; ownership is a FIELD. Until
 * there are enough codes to need an index, listing the type and matching the owner field is
 * honest and exact. Returns null when the wallet has never minted one.
 */
export async function findCreatorCode(
  client: { queryTransactionBlocks?: unknown },
  owner: string,
): Promise<string | null> {
  const q = `{ objects(filter: {type: "${PREDICT624.predictPackage}::builder_code::BuilderCode"}, first: 50) { nodes { address asMoveObject { contents { json } } } } }`;
  const res = await fetch('https://graphql.testnet.sui.io/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: q }),
  }).then((r) => r.json());
  const nodes = res?.data?.objects?.nodes ?? [];
  const want = owner.toLowerCase();
  for (const n of nodes) {
    const j = n?.asMoveObject?.contents?.json ?? {};
    if (String(j.owner ?? '').toLowerCase() === want) return n.address as string;
  }
  return null;
}
