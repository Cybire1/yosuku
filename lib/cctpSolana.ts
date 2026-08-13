// Solana half of multichain USDC deposits.
//
// Same rail as the EVM chains, different machine. depositForBurn on Solana is an Anchor
// instruction rather than an ERC20 approve plus contract call, so it needs PDA derivation and one
// genuinely unusual thing: the MessageSent event account is a FRESH KEYPAIR the client generates
// and signs, not a PDA. Circle stores the outgoing message in it so the attestation service can
// read it back. It costs about 0.003 SOL of rent, paid by whoever signs as event_rent_payer.
//
// Verified on devnet 2026-08-12: both programs are executable, local_token for the devnet USDC
// mint exists, and remote_token_messenger for domain 8 exists, which is the account that proves
// Solana to Sui is a configured route and not just a theoretical one.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const SOLANA_DOMAIN = 5;

export const SOL = {
  messageTransmitter: new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd'),
  tokenMessengerMinter: new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3'),
  usdcDevnet: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
  tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com',
  explorer: 'https://explorer.solana.com/tx/',
};

// Uint8Array everywhere, never Buffer. Next does not polyfill Node's Buffer in the browser, so
// Buffer.alloc returns something without writeBigUInt64LE and the instruction build throws
// "s.writeBigUInt64LE is not a function" at the moment the user clicks Deposit.
const seed = (s: string) => new TextEncoder().encode(s);
const pda = (seeds: Uint8Array[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

/** Anchor dispatches on the first 8 bytes of sha256("global:deposit_for_burn"). Hardcoded rather
 *  than hashed at runtime so this stays dependency-free and synchronous in the browser (Web Crypto
 *  is async, and @noble/hashes does not export the subpath under this package's export map).
 *  Value computed and checked against sha256("global:deposit_for_burn") = d73c3d2e723780b0…. */
const DEPOSIT_FOR_BURN_IX = new Uint8Array([215, 60, 61, 46, 114, 55, 128, 176]);

export const solPdas = (mint: PublicKey, destinationDomain: number) => ({
  messageTransmitter: pda([seed('message_transmitter')], SOL.messageTransmitter),
  tokenMessenger: pda([seed('token_messenger')], SOL.tokenMessengerMinter),
  tokenMinter: pda([seed('token_minter')], SOL.tokenMessengerMinter),
  senderAuthority: pda([seed('sender_authority')], SOL.tokenMessengerMinter),
  localToken: pda([seed('local_token'), mint.toBuffer()], SOL.tokenMessengerMinter),
  // Seeded with the destination domain rendered as a DECIMAL STRING, not a u32. Verified by
  // deriving it for "8" and finding the account live on devnet.
  remoteTokenMessenger: pda([seed('remote_token_messenger'), seed(String(destinationDomain))], SOL.tokenMessengerMinter),
  // Supplied by Anchor's #[event_cpi], which also appends event_authority and the program id as
  // the last two accounts. Omitting them makes the instruction fail with a confusing account
  // count error rather than anything that points at events.
  eventAuthority: pda([seed('__event_authority')], SOL.tokenMessengerMinter),
});

export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SOL.tokenProgram.toBuffer(), mint.toBuffer()],
    SOL.associatedTokenProgram,
  )[0];

/** A Sui address is 32 bytes, and Solana's mint_recipient is a 32-byte Pubkey, so it carries
 *  across with no truncation. Rejecting anything else rather than padding blindly, because a
 *  wrong recipient here burns the user's USDC to an address nobody holds. */
export function suiAddressToSolanaPubkey(addr: string): PublicKey {
  const hex = (addr || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,64}$/.test(hex)) throw new Error('Not a valid Sui address');
  const padded = hex.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  return new PublicKey(bytes);
}

/** depositForBurn. Account order matches Circle's DepositForBurnContext exactly; Anchor validates
 *  positionally, so a reordering is a silent wrong-account bug rather than a compile error. */
export function buildDepositForBurnIx(p: {
  owner: PublicKey;
  burnTokenAccount: PublicKey;
  mint: PublicKey;
  messageSentEventData: PublicKey;
  amount: bigint;
  destinationDomain: number;
  mintRecipient: PublicKey;
}): TransactionInstruction {
  const a = solPdas(p.mint, p.destinationDomain);

  // Borsh: u64 amount, u32 destination_domain, 32-byte recipient. Written through a DataView so
  // this does not depend on Buffer existing in the browser.
  const data = new Uint8Array(8 + 8 + 4 + 32);
  data.set(DEPOSIT_FOR_BURN_IX, 0);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, p.amount, true);   // little-endian
  view.setUint32(16, p.destinationDomain, true);
  data.set(p.mintRecipient.toBytes(), 20);

  return new TransactionInstruction({
    programId: SOL.tokenMessengerMinter,
    // web3.js TYPES this as Buffer but only ever reads it as raw bytes, so a Uint8Array is correct
    // at runtime. Casting here beats pulling Node's Buffer into the browser bundle just to satisfy
    // a type, which is what caused the crash in the first place.
    data: data as unknown as ConstructorParameters<typeof TransactionInstruction>[0]['data'],
    keys: [
      { pubkey: p.owner, isSigner: true, isWritable: false },
      { pubkey: p.owner, isSigner: true, isWritable: true },          // event_rent_payer
      { pubkey: a.senderAuthority, isSigner: false, isWritable: false },
      { pubkey: p.burnTokenAccount, isSigner: false, isWritable: true },
      { pubkey: a.messageTransmitter, isSigner: false, isWritable: true },
      { pubkey: a.tokenMessenger, isSigner: false, isWritable: false },
      { pubkey: a.remoteTokenMessenger, isSigner: false, isWritable: false },
      { pubkey: a.tokenMinter, isSigner: false, isWritable: false },
      { pubkey: a.localToken, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: true },
      { pubkey: p.messageSentEventData, isSigner: true, isWritable: true },
      { pubkey: SOL.messageTransmitter, isSigner: false, isWritable: false },
      { pubkey: SOL.tokenMessengerMinter, isSigner: false, isWritable: false },
      { pubkey: SOL.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: a.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: SOL.tokenMessengerMinter, isSigner: false, isWritable: false },
    ],
  });
}
