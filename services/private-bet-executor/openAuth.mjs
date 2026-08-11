// Proof that the person asking for a private bet is the person it will belong to.
//
// Opening a bet had no caller authentication at all: the proxy forwarded an anonymous request
// upstream with the server's own Bearer token attached, and `owner` was whatever the caller
// typed. Since the desk funds the mint, that made every open endpoint a faucet, and it let
// anyone attribute junk positions to someone else's address.
//
// The fix is a signature over the bet itself. Note the message is built to be READ, not just
// verified: it is what the wallet shows the user before they approve, so the prompt says
// "UP, $64,500, 2.00 DUSDC" rather than a hash. An authorization nobody can read is a
// confirmation dialog people click through.

import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

/** How long a signed authorization stays good. Long enough to survive a slow wallet prompt,
 *  short enough that a captured request is not reusable tomorrow. */
export const OPEN_AUTH_TTL_MS = 5 * 60 * 1000;

/**
 * The exact bytes both sides sign and check. Any drift here breaks every open, loudly, which is
 * the right failure: a mismatch must never degrade into "close enough, allow it".
 */
export function openAuthMessage(p) {
  return [
    'Yosuku private bet',
    '',
    `Side: ${p.isUp ? 'UP' : 'DOWN'}`,
    `Strike: $${Number(p.strike).toLocaleString('en-US')}`,
    `Stake: ${(Number(p.stakeMicro) / 1e6).toFixed(2)} DUSDC`,
    `Quantity: ${p.quantity}`,
    `Expiry: ${p.expiry}`,
    `Oracle: ${p.oracleId}`,
    `Owner: ${p.owner}`,
    `Issued: ${p.issuedAtMs}`,
  ].join('\n');
}

/**
 * Verify the request was authorized by `owner`.
 *
 * Recovers the signer from the signature and compares it to the claimed owner, so a caller
 * cannot name an address they do not control. Works for plain wallets and for zkLogin, which
 * needs a client to check the ephemeral key against the on-chain state.
 */
export async function verifyOpenAuthorization({ payload, signature, now = Date.now(), client }) {
  if (!signature || typeof signature !== 'string') {
    throw new Error('authorization signature required');
  }
  const issuedAtMs = Number(payload.issuedAtMs);
  if (!Number.isFinite(issuedAtMs)) throw new Error('issuedAtMs required');

  // Reject stale AND future-dated. A clock skewed forward would otherwise mint an
  // authorization that stays valid far longer than the window allows.
  const age = now - issuedAtMs;
  if (age > OPEN_AUTH_TTL_MS) throw new Error('authorization expired, please confirm again');
  if (age < -60_000) throw new Error('authorization is dated in the future');

  const bytes = new TextEncoder().encode(openAuthMessage(payload));
  let signer;
  try {
    signer = await verifyPersonalMessageSignature(bytes, signature, {
      address: payload.owner,
      ...(client ? { client } : {}),
    });
  } catch (e) {
    throw new Error(`authorization signature is not valid: ${e instanceof Error ? e.message : e}`);
  }

  const recovered = signer?.toSuiAddress?.();
  if (!recovered) throw new Error('authorization signature yielded no signer');
  if (recovered.toLowerCase() !== String(payload.owner).toLowerCase()) {
    throw new Error('authorization was signed by a different address than the owner');
  }
  return recovered;
}
