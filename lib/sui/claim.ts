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
export const SV_PKG = '0xf3c3c446d233c4371c0faa4bf7aa07f740e1c3eac7956e1d128bf6ead09d0706';   // social_vault pkg
export const VAULT = '0xbe9e96fb8cb6be797c00529fc1f4fe1119192299579167140a084d946851e07b';     // Vault<DUSDC>
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

// With the recovered account key, sweep the account's vault balance to the claimant's wallet.
// Signed by the account key K (the account self-pays gas from its onboarding drip).
export async function recoverFundsToWallet(opts: {
  suiClient: any;
  accountKeyBech32: string;
  toAddress: string;
  amountMist: bigint;
}): Promise<{ digest: string }> {
  const { suiClient, accountKeyBech32, toAddress, amountMist } = opts;
  const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(accountKeyBech32.trim()).secretKey);
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${SV_PKG}::social_vault::withdraw`,
    typeArguments: [DUSDC],
    arguments: [tx.object(VAULT), tx.pure.u64(amountMist)],
  });
  tx.transferObjects([coin], tx.pure.address(toAddress));
  const res = await suiClient.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true },
  });
  return { digest: res.digest };
}

// Ask the relay for this wallet's claimable account (set after the proof tweet is seen + bound).
export async function fetchClaimAccount(wallet: string): Promise<ClaimAccount | null> {
  const r = await fetch(`/api/claim/info?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`claim lookup failed (${r.status})`);
  const j = await r.json();
  return j?.account ?? null;
}
