export type PrivacyMode = 'public' | 'private';

export interface PrivateBetStatus {
  ready: boolean;
  label: 'READY' | 'BETA';
  reasons: string[];
  vortexPool: string;
  mode?: 'sponsored-session-manager' | 'vortex' | 'unconfigured' | string;
  sessionAddress?: string;
  maxStakeDusdc?: number | null;
  privateBalanceEnabled?: boolean;
  withdrawModes?: PrivateWithdrawMode[];
}

export type PrivateWithdrawMode = 'fast' | 'private';

export interface PrivateBetTicket {
  digest: string;
  owner: string;
  oracleId: string;
  expiry: number;
  strike: number;
  side: 'UP' | 'DOWN';
  stakeMicro: number;
  quantity: number;
  costDusdc: number;
  sessionAddress?: string;
  sessionManager?: string;
  entryDigest?: string;
  returnDigest?: string;
  /** The enclave-signed claim. This IS the proof the position is yours: the desk keeps no
   *  record of who owns what, so losing this means losing the ability to cash out. */
  ticketHex?: string;
  signatureHex?: string;
  enclavePublicKey?: string;
  cashoutDigest?: string;
  redeemDigest?: string;
  payoutDusdc?: number;
  withdrawDigest?: string;
  withdrawMode?: PrivateWithdrawMode;
  status: 'open' | 'settled' | 'credited' | 'withdrawn' | 'cashed_out';
  openedAt: number;
  creditedAt?: number;
  withdrewAt?: number;
  mode?: string;
}

export interface PrivateBetOpenArgs {
  owner: string;
  /** Signs the human-readable authorization the desk checks against `owner`. Wire this to
   *  dapp-kit's useSignPersonalMessage; it works for both wallets and zkLogin. */
  signPersonalMessage: (message: Uint8Array) => Promise<{ signature: string }>;
  oracleId: string;
  expiry: number;
  strike: number;
  side: 'UP' | 'DOWN';
  stakeMicro: number;
  quantity: number;
  maxCostDusdc: number;
}

interface PrivateBetOpenResponse {
  digest?: string;
  costDusdc?: number;
  sessionAddress?: string;
  sessionManager?: string;
  entryDigest?: string;
  returnDigest?: string;
  mode?: string;
  ticketHex?: string;
  signatureHex?: string;
  enclavePublicKey?: string;
  error?: string;
}

interface PrivateCashoutResponse {
  digest?: string;
  payoutDusdc?: number;
  creditedAt?: number;
  returnDigest?: string;
  error?: string;
}

interface PrivateWithdrawResponse {
  digest?: string;
  returnDigest?: string;
  payoutDusdc?: number;
  ticketDigests?: string[];
  mode?: PrivateWithdrawMode;
  error?: string;
}

const PRIVATE_TICKETS_KEY = 'yosuku_private_bet_tickets';

export const EMPTY_PRIVATE_STATUS: PrivateBetStatus = {
  ready: false,
  label: 'BETA',
  reasons: ['Checking private route...'],
  vortexPool: '',
};

export async function getPrivateBetStatus(): Promise<PrivateBetStatus> {
  const res = await fetch('/api/private-bet/status', { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Private route status failed: ${res.status}`);
  return json as PrivateBetStatus;
}

export function loadPrivateBetTickets(owner?: string | null): PrivateBetTicket[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRIVATE_TICKETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PrivateBetTicket[];
    if (!Array.isArray(parsed)) return [];
    return owner ? parsed.filter((ticket) => ticket.owner.toLowerCase() === owner.toLowerCase()) : parsed;
  } catch {
    return [];
  }
}

export function savePrivateBetTickets(tickets: PrivateBetTicket[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PRIVATE_TICKETS_KEY, JSON.stringify(tickets.slice(0, 40)));
}

export function privateTicketBalanceDusdc(ticket: PrivateBetTicket): number {
  return ticket.status === 'credited' ? Math.max(0, ticket.payoutDusdc ?? 0) : 0;
}

export function privateBalanceDusdc(tickets: PrivateBetTicket[]): number {
  return tickets.reduce((sum, ticket) => sum + privateTicketBalanceDusdc(ticket), 0);
}

/** The exact bytes the desk rebuilds and verifies. Kept human-readable on purpose: this is what
 *  the wallet shows before someone approves, so the prompt names the actual bet. Must stay
 *  byte-identical to openAuthMessage() in services/private-bet-executor/openAuth.mjs. */
export function openAuthMessage(p: {
  owner: string; oracleId: string; expiry: number | string; strike: number | string;
  isUp: boolean; stakeMicro: number | string; quantity: number | string; issuedAtMs: number;
}): string {
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

export async function openPrivateBet(args: PrivateBetOpenArgs, status: PrivateBetStatus): Promise<PrivateBetTicket> {
  if (!status.ready) throw new Error(status.reasons[0] ?? 'Private route is not ready.');

  const issuedAtMs = Date.now();
  const authPayload = {
    owner: args.owner,
    oracleId: args.oracleId,
    expiry: String(args.expiry),
    strike: String(args.strike),
    isUp: args.side === 'UP',
    stakeMicro: String(args.stakeMicro),
    quantity: String(args.quantity),
    issuedAtMs,
  };
  const { signature: authSignature } = await args.signPersonalMessage(
    new TextEncoder().encode(openAuthMessage(authPayload)),
  );

  const res = await fetch('/api/private-bet/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      owner: args.owner,
      vortexPool: status.vortexPool,
      oracleId: args.oracleId,
      expiry: String(args.expiry),
      strike: String(args.strike),
      isUp: args.side === 'UP',
      stakeMicro: String(args.stakeMicro),
      quantity: String(args.quantity),
      maxCostDusdc: args.maxCostDusdc,
      authSignature,
      issuedAtMs,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as PrivateBetOpenResponse;
  if (!res.ok || json.error || !json.digest) {
    throw new Error(json.error ?? `Private route failed: ${res.status}`);
  }

  return {
    digest: json.digest,
    owner: args.owner,
    oracleId: args.oracleId,
    expiry: args.expiry,
    strike: args.strike,
    side: args.side,
    stakeMicro: args.stakeMicro,
    quantity: args.quantity,
    costDusdc: typeof json.costDusdc === 'number' ? json.costDusdc : args.maxCostDusdc,
    sessionAddress: json.sessionAddress,
    sessionManager: json.sessionManager,
    entryDigest: json.entryDigest,
    returnDigest: json.returnDigest,
    ticketHex: json.ticketHex,
    signatureHex: json.signatureHex,
    enclavePublicKey: json.enclavePublicKey,
    mode: json.mode,
    status: 'open',
    openedAt: Date.now(),
  };
}

export async function cashOutPrivateBet(ticket: PrivateBetTicket, status: PrivateBetStatus): Promise<PrivateBetTicket> {
  if (!status.ready) throw new Error(status.reasons[0] ?? 'Private route is not ready.');

  const res = await fetch('/api/private-bet/cashout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Present the enclave's signed claim and nothing else. Sending `owner` here would be
    // theatre: the desk reads the owner out of the signature, so a caller naming themselves
    // gets nowhere. Every bet parameter likewise comes from inside the signed bytes.
    body: JSON.stringify({
      vortexPool: status.vortexPool,
      ticketHex: ticket.ticketHex,
      signatureHex: ticket.signatureHex,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as PrivateCashoutResponse;
  if (!res.ok || json.error || !json.digest) {
    throw new Error(json.error ?? `Private cashout failed: ${res.status}`);
  }

  // Winnings now settle STRAIGHT into the user's Trading Balance (no separate Private Balance).
  return {
    ...ticket,
    status: 'settled',
    cashoutDigest: json.digest,
    redeemDigest: json.digest,
    payoutDusdc: typeof json.payoutDusdc === 'number' ? json.payoutDusdc : ticket.payoutDusdc,
    returnDigest: json.returnDigest ?? ticket.returnDigest,
    creditedAt: typeof json.creditedAt === 'number' ? json.creditedAt : Date.now(),
  };
}

export async function withdrawPrivateBalance(
  owner: string,
  tickets: PrivateBetTicket[],
  status: PrivateBetStatus,
  mode: PrivateWithdrawMode,
): Promise<PrivateBetTicket[]> {
  if (!status.ready) throw new Error(status.reasons[0] ?? 'Private route is not ready.');

  const creditedTickets = tickets.filter((ticket) => ticket.status === 'credited' && privateTicketBalanceDusdc(ticket) > 0);
  if (creditedTickets.length === 0) throw new Error('No private balance is available to withdraw.');

  // Only claims the enclave signed can be withdrawn. A credited position whose claim is missing
  // cannot be proven to be yours, so say that plainly rather than sending a request that the
  // desk will reject with something cryptic.
  const claimable = creditedTickets.filter((t) => t.ticketHex && t.signatureHex);
  if (claimable.length === 0) {
    throw new Error('These positions have no signed claim on this device. Restore from your backup first.');
  }

  const res = await fetch('/api/private-bet/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      vortexPool: status.vortexPool,
      mode,
      claims: claimable.map((t) => ({ ticketHex: t.ticketHex, signatureHex: t.signatureHex })),
    }),
  });

  const json = (await res.json().catch(() => ({}))) as PrivateWithdrawResponse;
  if (!res.ok || json.error || !json.digest) {
    throw new Error(json.error ?? `Private balance withdraw failed: ${res.status}`);
  }

  const settled = new Set(json.ticketDigests?.length ? json.ticketDigests : creditedTickets.map((ticket) => ticket.digest));
  const withdrewAt = Date.now();
  return tickets.map((ticket) => {
    if (!settled.has(ticket.digest)) return ticket;
    return {
      ...ticket,
      status: 'withdrawn',
      withdrawDigest: json.digest,
      returnDigest: json.returnDigest ?? json.digest,
      withdrawMode: json.mode ?? mode,
      withdrewAt,
    };
  });
}

// ─── the claim is yours ───
//
// The desk keeps no record of who owns which position, which is the point, and also the risk:
// a cleared browser is a lost bet. These helpers exist so that risk is something a user can
// actually manage rather than something they discover afterwards.

/** Verify a claim was signed by the attested enclave. Runs locally, so a user never has to take
 *  the desk's word for it. The key is checked against the one pinned on chain. */
export async function verifyClaim(ticket: PrivateBetTicket, enclavePublicKey?: string): Promise<boolean> {
  const pk = (enclavePublicKey ?? ticket.enclavePublicKey ?? '').replace(/^0x/, '');
  if (!pk || !ticket.ticketHex || !ticket.signatureHex) return false;
  try {
    const { Ed25519PublicKey } = await import('@mysten/sui/keypairs/ed25519');
    const key = new Ed25519PublicKey(hexToBytes(pk));
    return await key.verify(hexToBytes(ticket.ticketHex), hexToBytes(ticket.signatureHex));
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A portable copy of every claim this browser holds. Plain JSON on purpose: it has to survive
 *  a lost laptop, a new device, and this app going away. */
export function exportClaims(owner?: string | null): string {
  return JSON.stringify(
    { kind: 'yosuku.private.claims', version: 1, exportedAt: Date.now(), claims: loadPrivateBetTickets(owner) },
    null,
    2,
  );
}

/** Merge a backup back in. Existing claims win, so restoring an old file cannot roll a
 *  cashed-out position back to "open" and strand it. Returns how many were added. */
export function importClaims(raw: string): number {
  const parsed = JSON.parse(raw) as { claims?: PrivateBetTicket[] };
  const incoming = Array.isArray(parsed?.claims) ? parsed.claims : [];
  if (incoming.length === 0) return 0;
  const existing = loadPrivateBetTickets();
  const seen = new Set(existing.map((t) => t.digest));
  const added = incoming.filter((t) => t?.digest && !seen.has(t.digest));
  if (added.length > 0) savePrivateBetTickets([...added, ...existing]);
  return added.length;
}
