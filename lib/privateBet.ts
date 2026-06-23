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

export async function openPrivateBet(args: PrivateBetOpenArgs, status: PrivateBetStatus): Promise<PrivateBetTicket> {
  if (!status.ready) throw new Error(status.reasons[0] ?? 'Private route is not ready.');

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
    body: JSON.stringify({
      owner: ticket.owner,
      vortexPool: status.vortexPool,
      ticket: {
        digest: ticket.digest,
        sessionAddress: ticket.sessionAddress,
        sessionManager: ticket.sessionManager,
        oracleId: ticket.oracleId,
        expiry: String(ticket.expiry),
        strike: String(ticket.strike),
        isUp: ticket.side === 'UP',
        stakeMicro: String(ticket.stakeMicro),
        quantity: String(ticket.quantity),
      },
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

  const res = await fetch('/api/private-bet/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      owner,
      vortexPool: status.vortexPool,
      mode,
      ticketDigests: creditedTickets.map((ticket) => ticket.digest),
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
