// Claim an auto-onboarded (tweet-funded) account to your own wallet.
//
// Flow: prove your X handle (tweet "@yosuku0 claim <wallet>") → the relay binds set_owner(authorId→wallet)
// on the HandleRegistry → then ONLY that wallet can unseal the account's withdraw key (Seal gates on the
// on-chain binding) → we recover the key in-browser and sweep the account's vault balance to your wallet.
//
// Non-custodial: the relay discarded the plaintext key at onboarding; it physically cannot unseal it.
import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex } from '@mysten/sui/utils';

export const SEAL_PKG = '0x4ade283c489af2d5bdb59cb142a8bf1c39b9000933f3b7d88cc55c12cf4b9440'; // yosuku_seal
export const REGISTRY = '0xd6dc7eefb8538a602961fd64c2b4ea72fc9a5aae7d79a5f4adb16058aeec8562'; // HandleRegistry
// vault624 — where tweet-bettors' funds actually live (the social_vault above is legacy).
export const V624_PKG = '0x27931b561d585164fd843c4d58943281f0fcd1f9ca5db684f8fd47b5ee3791b3';
export const V624_VAULT = '0x3f99ddeda9c1388b8c85777a4931f64143fb5fc70cacc6df132d607b08bb044d';
export const V624_WRAPPER = '0xc526da75acf134b160a4c442fb0bacbcd95aeff6daf2be759b65d39ec64f6f51';
export const ACCUM_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000acc';
export const CLOCK = '0x6';
export const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const SEAL_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];
const WALRUS_AGG = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';

type SignPersonalMessage = (input: { message: Uint8Array }) => Promise<{ signature: string }>;

export type ClaimAccount = {
  address: string;        // the auto-account address A
  sealId: string;         // hex seal identity (registry ++ authorId)
  blobId: string;         // Walrus blob holding the sealed key
  balanceDusdc: number;   // recoverable vault balance
  owner: string | null;   // current on-chain binding (null = unclaimed)
};

// Unseal the account's withdraw key — succeeds ONLY if the on-chain registry binds `address` (the
// connected wallet) as the owner. Mirrors x-relay/seal-helper/decrypt.mjs, adapted for a browser wallet.
export async function unsealAccountKey(opts: {
  suiClient: any;
  walletAddress: string;
  sealIdHex: string;
  blobId: string;
  signPersonalMessage: SignPersonalMessage;
}): Promise<string> {
  const { suiClient, walletAddress, sealIdHex, blobId, signPersonalMessage } = opts;
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: SEAL_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
    verifyKeyServers: false,
  });
  const r = await fetch(`${WALRUS_AGG}/${blobId}`);
  if (!r.ok) throw new Error(`Couldn't fetch the sealed key from Walrus (${r.status}).`);
  const ct = new Uint8Array(await r.arrayBuffer());

  const sessionKey = await SessionKey.create({ address: walletAddress, packageId: SEAL_PKG, ttlMin: 10, suiClient });
  const { signature } = await signPersonalMessage({ message: sessionKey.getPersonalMessage() });
  await sessionKey.setPersonalMessageSignature(signature);

  const tx = new Transaction();
  tx.moveCall({
    target: `${SEAL_PKG}::handle_registry::seal_approve`,
    arguments: [tx.pure.vector('u8', fromHex(sealIdHex)), tx.object(REGISTRY)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  const dec = await sealClient.decrypt({ data: ct, sessionKey, txBytes });
  return new TextDecoder().decode(dec); // bech32 suiprivkey…
}

// With the recovered account key, sweep the account's vault624 balance to the claimant's wallet.
// Signed by the account key K (the account self-pays gas from its onboarding SUI drip). vault624's
// `withdraw` public_transfers the DUSDC to the account itself, so this is two moves:
//   1. K withdraws the ledger balance from vault624 → DUSDC lands in account A
//   2. K transfers that DUSDC to the claimant's connected wallet
export async function recoverFundsToWallet(opts: {
  suiClient: any;
  accountKeyBech32: string;
  toAddress: string;
  amountMist: bigint;
}): Promise<{ digest: string }> {
  const { suiClient, accountKeyBech32, toAddress, amountMist } = opts;
  const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(accountKeyBech32.trim()).secretKey);
  const A = kp.toSuiAddress();

  // 1. withdraw the ledger balance out of vault624 (lands in A; no coin returned to the PTB)
  const wtx = new Transaction();
  wtx.moveCall({
    target: `${V624_PKG}::vault624::withdraw`,
    arguments: [wtx.object(V624_VAULT), wtx.object(V624_WRAPPER), wtx.pure.u64(amountMist), wtx.object(ACCUM_ROOT), wtx.object(CLOCK)],
  });
  wtx.setGasBudget(60_000_000);
  const wres = await suiClient.signAndExecuteTransaction({ signer: kp, transaction: wtx, options: { showEffects: true } });
  if (wres.effects?.status?.status !== 'success') throw new Error(`withdraw failed: ${wres.effects?.status?.error ?? 'unknown'}`);

  // 2. sweep the account's DUSDC to the claimant's wallet
  const coins = await suiClient.getCoins({ owner: A, coinType: DUSDC });
  const ids = (coins.data ?? []).map((c: any) => c.coinObjectId);
  if (!ids.length) throw new Error('withdraw succeeded but no DUSDC coin found to send.');
  const ttx = new Transaction();
  if (ids.length > 1) ttx.mergeCoins(ttx.object(ids[0]), ids.slice(1).map((id: string) => ttx.object(id)));
  ttx.transferObjects([ttx.object(ids[0])], ttx.pure.address(toAddress));
  ttx.setGasBudget(30_000_000);
  const tres = await suiClient.signAndExecuteTransaction({ signer: kp, transaction: ttx, options: { showEffects: true } });
  return { digest: tres.digest };
}

// Ask the relay for this wallet's claimable account (set after the proof tweet is seen + bound).
export async function fetchClaimAccount(wallet: string): Promise<ClaimAccount | null> {
  const r = await fetch(`/api/claim/info?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`claim lookup failed (${r.status})`);
  const j = await r.json();
  return j?.account ?? null;
}
