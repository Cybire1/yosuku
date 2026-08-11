// Multichain USDC deposits into Sui, source-chain half.
//
// The user burns USDC on another chain naming their Sui address as mint_recipient. Circle signs
// an attestation once the source chain hits hard finality, and our keeper submits the Sui receive
// so the user never needs SUI or a Sui signature.
//
// V1 ONLY, AND THAT IS NOT A CHOICE. Sui is on CCTP V1 (Legacy); Circle's canonical version is V2
// and Sui does not have it yet. A V2 burn cannot be received by V1 contracts, so the addresses
// below MUST be the V1 TokenMessenger on each source chain. Grabbing the V2 address because it is
// what Circle's docs show first would produce a burn that succeeds on the source chain and can
// never be redeemed on Sui: the user's money would be gone with nothing to relay. Every address
// here was verified on its own chain (contract code present, USDC symbol and 6 decimals, chain id
// matches) on 2026-08-11.
//
// V1 also entered a phased wind-down on 2026-07-31, so this whole file has a shelf life. When Sui
// gets V2 it is replaced wholesale, which is why nothing here leaks into components.

export const SUI_DOMAIN = 8;

export type SourceChain = {
  domain: number;
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  tokenMessenger: `0x${string}`;
  usdc: `0x${string}`;
  /** Wall-clock hard finality. This is the number the UI must show, because it is the difference
   *  between a deposit that is part of placing a bet and one that outlives the market. */
  seconds: number;
  nativeSymbol: string;
};

/** Ordered fast-first on purpose. Whatever sits at the top is what most people pick, and on the
 *  slow chains the market a user was looking at will have settled before their money lands. */
export const SOURCE_CHAINS: SourceChain[] = [
  {
    domain: 1, chainId: 43113, name: 'Avalanche Fuji', nativeSymbol: 'AVAX',
    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',
    explorer: 'https://testnet.snowtrace.io/tx/',
    tokenMessenger: '0xeb08f243E5d3FCFF26A9E38Ae5520A669f4019d0',
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    seconds: 8,
  },
  {
    domain: 7, chainId: 80002, name: 'Polygon Amoy', nativeSymbol: 'POL',
    rpc: 'https://polygon-amoy-bor-rpc.publicnode.com',
    explorer: 'https://amoy.polygonscan.com/tx/',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    seconds: 8,
  },
  {
    domain: 6, chainId: 84532, name: 'Base Sepolia', nativeSymbol: 'ETH',
    rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org/tx/',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    seconds: 19 * 60,
  },
  {
    domain: 0, chainId: 11155111, name: 'Ethereum Sepolia', nativeSymbol: 'ETH',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io/tx/',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    seconds: 19 * 60,
  },
];

export const chainByDomain = (d: number) => SOURCE_CHAINS.find((c) => c.domain === d);

/** "about 10 seconds" beats "8s" for a human, and the slow chains must never be rounded down into
 *  sounding quick. Users forgive a wait they were told about. */
export const humanWait = (seconds: number) =>
  seconds <= 30 ? 'about 10 seconds' : `about ${Math.round(seconds / 60)} minutes`;

/** A Sui address is already 32 bytes, which is exactly what CCTP's bytes32 mintRecipient wants, so
 *  this is a validation and pad rather than a conversion. EVM's 20-byte addresses need left
 *  padding here; Sui's do not, and quietly truncating or re-padding a Sui address would send the
 *  mint somewhere unrecoverable. Hence the hard reject instead of a best-effort fix. */
export function suiAddressToBytes32(addr: string): `0x${string}` {
  const hex = (addr || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,64}$/.test(hex)) throw new Error('Not a valid Sui address');
  return `0x${hex.padStart(64, '0')}` as `0x${string}`;
}

export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

/** CCTP V1 TokenMessenger. V1's depositForBurn takes four args; V2 added minFinalityThreshold and
 *  fee params, so the two ABIs are NOT interchangeable and using the wrong one reverts. */
export const TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '_nonce', type: 'uint64' }],
  },
] as const;

// The browser never talks to the keeper directly. It sits on a Tailscale address that is not
// routable from a visitor's machine, and should not be exposed just to make a fetch simpler, so
// everything goes through our own API route.
const API = '/api/deposit/cctp';

export type DepositStatus =
  | { status: 'unknown' }
  | { status: 'pending'; enqueuedAt: number; etaSeconds: number; dead?: string }
  | { status: 'failed'; dead: string }
  | { status: 'delivered'; digest: string | null; amountMicro?: string; recipient?: string };

/** Hand the burn to the keeper. Deliberately fire-and-forget from the user's point of view: the
 *  deposit is now a background job, so nothing about the UI should block on it. */
export async function notifyKeeper(sourceDomain: number, txHash: string, user?: string) {
  await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceDomain, txHash, user }),
  }).catch(() => {});
}

export async function pollDeposit(sourceDomain: number, txHash: string): Promise<DepositStatus> {
  try {
    const r = await fetch(`${API}?domain=${sourceDomain}&tx=${encodeURIComponent(txHash)}`, { cache: 'no-store' });
    if (!r.ok) return { status: 'unknown' };
    return (await r.json()) as DepositStatus;
  } catch {
    return { status: 'unknown' };
  }
}

/** Is the rail actually wired up? The card hides itself when it is not, because a burn with no
 *  keeper behind it leaves the user's USDC stranded until someone relays it by hand. */
export async function cctpConfigured(): Promise<boolean> {
  try {
    const r = await fetch(API, { cache: 'no-store' });
    return !!(await r.json())?.configured;
  } catch { return false; }
}
