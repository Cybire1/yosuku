import type { Market } from '@/components/MarketCard';

/**
 * Calculate relevance score for search ranking
 * Higher score = better match
 */
function calculateRelevanceScore(market: Market, query: string): number {
  let score = 0;
  const q = query.toLowerCase().trim();
  const question = market.question.toLowerCase();

  if (!q) return 0;

  // Exact match in question (highest priority)
  if (question === q) score += 200;

  // Starts with query (very high priority)
  if (question.startsWith(q)) score += 150;

  // Contains query as whole word
  const words = question.split(' ');
  if (words.some(word => word === q)) score += 100;

  // Contains query anywhere
  if (question.includes(q)) score += 75;

  // Category exact match
  if (market.category?.toLowerCase() === q) score += 60;

  // Category contains query
  if (market.category?.toLowerCase().includes(q)) score += 40;

  // Fuzzy matching for typos (simple Levenshtein distance)
  const fuzzyMatches = words.filter(word => {
    return levenshteinDistance(word, q) <= 2;
  });
  if (fuzzyMatches.length > 0) score += 30;

  // Volume bonus (log scale) - popular markets rank higher
  if (market.total_volume > 0) {
    score += Math.log10(market.total_volume + 1) * 5;
  }

  // Active markets get bonus
  if (!market.resolved) score += 10;

  return score;
}

/**
 * Simple Levenshtein distance for fuzzy matching
 * Detects typos like "bitcon" → "bitcoin"
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Main search function with intelligent ranking
 */
export function searchMarkets(markets: Market[], query: string): Market[] {
  const normalized = query.trim();

  // Return all markets if no query
  if (!normalized) return markets;

  // Calculate scores and filter
  const scored = markets
    .map(market => ({
      market,
      score: calculateRelevanceScore(market, normalized)
    }))
    .filter(item => item.score > 0) // Only include matches
    .sort((a, b) => b.score - a.score); // Sort by relevance

  return scored.map(item => item.market);
}

/**
 * Get search suggestions based on popular queries
 */
export function getSearchSuggestions(markets: Market[]): string[] {
  const suggestions = new Set<string>();

  // Add popular categories
  suggestions.add('Bitcoin');
  suggestions.add('Trump');
  suggestions.add('Sports');
  suggestions.add('Politics');
  suggestions.add('Crypto');

  // Add from actual market questions (extract key terms)
  markets.forEach(market => {
    const words = market.question.split(' ');
    words.forEach(word => {
      const cleaned = word.replace(/[?.,!]/g, '').toLowerCase();
      if (cleaned.length > 4) {
        suggestions.add(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
      }
    });
  });

  return Array.from(suggestions).slice(0, 10);
}

/**
 * Store recent searches in localStorage
 */
export function saveRecentSearch(query: string) {
  if (!query.trim()) return;

  try {
    const recent = getRecentSearches();
    const updated = [query, ...recent.filter(q => q !== query)].slice(0, 5);
    localStorage.setItem('recent_searches', JSON.stringify(updated));
  } catch (error) {
    console.error('Error saving recent search:', error);
  }
}

/**
 * Get recent searches from localStorage
 */
export function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem('recent_searches');
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading recent searches:', error);
    return [];
  }
}

/**
 * Clear recent searches
 */
export function clearRecentSearches() {
  try {
    localStorage.removeItem('recent_searches');
  } catch (error) {
    console.error('Error clearing recent searches:', error);
  }
}
