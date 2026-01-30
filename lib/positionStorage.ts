// Local storage for user positions
// Since Aleo positions are private records, we track them locally

export interface StoredPosition {
  marketId: string;
  question: string;
  side: 'YES' | 'NO';
  shares: number;
  entryPrice: number;
  timestamp: number;
  txHash?: string;
  userAddress: string;
}

const STORAGE_KEY = 'dart_user_positions';

export function savePosition(position: StoredPosition): void {
  try {
    const positions = getAllPositions();
    positions.push(position);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch (error) {
    console.error('Error saving position:', error);
  }
}

export function getAllPositions(): StoredPosition[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading positions:', error);
    return [];
  }
}

export function getUserPositions(userAddress: string): StoredPosition[] {
  return getAllPositions().filter(p => p.userAddress === userAddress);
}

export function getPositionsByMarket(marketId: string): StoredPosition[] {
  return getAllPositions().filter(p => p.marketId === marketId);
}

export function removePosition(marketId: string, userAddress: string, side: 'YES' | 'NO'): void {
  try {
    const positions = getAllPositions().filter(
      p => !(p.marketId === marketId && p.userAddress === userAddress && p.side === side)
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch (error) {
    console.error('Error removing position:', error);
  }
}

export function clearAllPositions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing positions:', error);
  }
}
