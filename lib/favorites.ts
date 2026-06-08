const STORAGE_KEY = 'yosuku_favorites';

export function loadFavorites(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
  } catch { /* ignore */ }
}

export function toggleFavorite(oracleId: string): Set<string> {
  const favs = loadFavorites();
  if (favs.has(oracleId)) {
    favs.delete(oracleId);
  } else {
    favs.add(oracleId);
  }
  saveFavorites(favs);
  return favs;
}
