import type { MirrorMarketData } from './mirrorMarkets';

export type PrivateRoomId = 'public' | 'macro-desk' | 'altcoin-war-room' | 'signal-room';

export interface PrivateRoom {
  id: PrivateRoomId;
  name: string;
  description: string;
  privacy: 'public' | 'invite-only';
  code?: string;
}

const UNLOCKED_ROOMS_KEY = 'dart_private_rooms';

export const PRIVATE_ROOMS: PrivateRoom[] = [
  {
    id: 'public',
    name: 'Open Feed',
    description: 'Open Aleo markets visible to everyone.',
    privacy: 'public',
  },
  {
    id: 'macro-desk',
    name: 'Macro Desk',
    description: 'Invite-only room for majors, ETFs, rates, and macro-sensitive conviction.',
    privacy: 'invite-only',
    code: 'DART-MACRO',
  },
  {
    id: 'altcoin-war-room',
    name: 'Altcoin War Room',
    description: 'Private room for higher-beta crypto sentiment and faster narrative shifts.',
    privacy: 'invite-only',
    code: 'DART-ALTS',
  },
  {
    id: 'signal-room',
    name: 'Signal Room',
    description: 'Restricted room for high-sensitivity markets that should not sit in the open queue.',
    privacy: 'invite-only',
    code: 'DART-SIGNAL',
  },
];

export function loadUnlockedRooms(): PrivateRoomId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNLOCKED_ROOMS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((room): room is PrivateRoomId => PRIVATE_ROOMS.some((candidate) => candidate.id === room));
  } catch {
    return [];
  }
}

export function unlockRoom(roomId: PrivateRoomId, code: string): boolean {
  const room = PRIVATE_ROOMS.find((candidate) => candidate.id === roomId);
  if (!room || room.privacy === 'public') return true;
  if (!room.code || room.code.toLowerCase() !== code.trim().toLowerCase()) return false;

  const unlocked = new Set<PrivateRoomId>(loadUnlockedRooms());
  unlocked.add(roomId);
  localStorage.setItem(UNLOCKED_ROOMS_KEY, JSON.stringify(Array.from(unlocked)));
  return true;
}

export function isRoomUnlocked(roomId: PrivateRoomId, unlockedRooms: PrivateRoomId[]): boolean {
  return roomId === 'public' || unlockedRooms.includes(roomId);
}

export function getRoomIdsForMirrorMarket(market: MirrorMarketData): PrivateRoomId[] {
  const text = `${market.question} ${market.description || ''} ${market.category}`.toLowerCase();
  const volume = market.volume24hr || market.volume;
  const isMajor = /(btc|bitcoin|eth|ethereum|rates|etf)/.test(text);
  const isAlt = /(sol|solana|doge|xrp|sui|memecoin|altcoin)/.test(text);

  if (isMajor) {
    return volume >= 100_000
      ? ['public', 'macro-desk', 'signal-room']
      : ['public', 'macro-desk'];
  }

  if (isAlt) {
    return volume >= 50_000
      ? ['public', 'altcoin-war-room', 'signal-room']
      : ['public', 'altcoin-war-room'];
  }

  // Default to public visibility so the mirror feed never looks empty.
  // Private rooms remain useful as curated sub-feeds rather than hard gates.
  return ['public', 'signal-room'];
}

export function isMirrorVisibleInRoom(
  market: MirrorMarketData,
  roomId: PrivateRoomId,
  unlockedRooms: PrivateRoomId[],
): boolean {
  const rooms = getRoomIdsForMirrorMarket(market);
  return rooms.includes(roomId) && isRoomUnlocked(roomId, unlockedRooms);
}
