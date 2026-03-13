import { createHash } from 'node:crypto';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const ALEO_FIELD_SPACE = 1n << 250n;
const MIRROR_MARKET_ID_SPACE = 1n << 63n;

interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  endDate?: string;
  category?: string;
  volumeNum?: number;
  liquidityNum?: number;
  outcomePrices?: string;
  outcomes?: string;
  slug: string;
  volume24hr?: number;
  volume1wk?: number;
  commentCount?: number;
  clobTokenIds?: string;
  createdAt?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
}

interface ClobPriceResponse {
  price?: string;
}

interface ClobPriceHistoryPoint {
  t: number;
  p: number | string;
}

interface ClobPriceHistoryResponse {
  history?: ClobPriceHistoryPoint[];
}

export interface MirrorCandidate {
  source: 'polymarket';
  sourceMarketId: string;
  marketId: string;
  slug: string;
  question: string;
  description?: string;
  category: string;
  endDate?: string;
  outcomeLabels: [string, string];
  outcomePrices: [number, number];
  publicYesPrice: number;
  publicNoPrice: number;
  yesMultiplierBps: number;
  noMultiplierBps: number;
  volume: number;
  volume24hr: number;
  volume1wk: number;
  yesPriceChange24h: number;
  yesPriceChange1w: number;
  liquidity: number;
  commentCount: number;
  hasLivePrice: boolean;
  active: boolean;
  closed: boolean;
  sourceHash: string;
  sourceHashField: string;
  conditionHash: string;
  conditionHashField: string;
  resolutionHash?: string;
  resolutionHashField?: string;
  resolvedOutcome: boolean | null;
  onChainCreated?: boolean;
  onChainResolved?: boolean;
  onChainCloseBlock?: number | null;
  vaultAddress?: string | null;
}

export interface FetchMirrorOptions {
  limit: number;
  query?: string;
  active: boolean;
  closed: boolean;
  minVolume: number;
  maxDurationSecs: number;
}

function hashToField(value: string): { decimal: string; field: string } {
  const digest = createHash('sha256').update(value).digest('hex');
  const numeric = BigInt(`0x${digest}`) % ALEO_FIELD_SPACE;
  return {
    decimal: numeric.toString(),
    field: `${numeric.toString()}field`,
  };
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/\b(bitcoin|btc|ethereum|eth|crypto|solana|defi|nft|blockchain|altcoin|stablecoin|memecoin|dogecoin|xrp|binance|coinbase)\b/i, 'Crypto'],
  [/\b(trump|biden|election|congress|senate|president|democrat|republican|gop|governor|vote|ballot|political|white house|cabinet|impeach|partisan)\b/i, 'Politics'],
  [/\b(fed\b|interest rate|inflation|gdp|recession|stock market|nasdaq|dow jones|s&p|tariff|trade war|unemployment|cpi|fomc|treasury|economic)\b/i, 'Economics'],
  [/\b(nba|nfl|mlb|nhl|fifa|world cup|premier league|champions league|super bowl|playoff|mvp|soccer|basketball|baseball|tennis|formula 1|ufc|boxing|olympics)\b/i, 'Sports'],
  [/\b(openai|gpt|chatgpt|google|apple|microsoft|tesla|spacex|nvidia|semiconductor|artificial intelligence|agi|android|iphone)\b/i, 'Tech'],
  [/\b(war|ceasefire|ukraine|russia|israel|gaza|nato|taiwan|missile|sanction|nuclear|invasion|troops)\b/i, 'Geopolitics'],
  [/\b(oscar|grammy|album|movie|film|netflix|spotify|tiktok|youtube|celebrity|rapper|gta|rihanna|drake|kanye|taylor swift|emmy)\b/i, 'Entertainment'],
];

function inferCategory(question: string, description?: string): string {
  const text = `${question} ${description || ''}`;
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(text)) return category;
  }
  return 'Other';
}

function deriveMirrorMarketId(sourceHash: string): string {
  const numeric = BigInt(sourceHash) % MIRROR_MARKET_ID_SPACE;
  return (numeric === 0n ? 1n : numeric).toString();
}

function normalizeQueryTerms(query?: string): string[] {
  return (query || '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function matchesQuery(market: GammaMarket, queryTerms: string[]): boolean {
  if (queryTerms.length === 0) return true;
  const haystack = [market.question, market.description, market.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return queryTerms.some((term) => haystack.includes(term));
}

function parseStringArray(raw?: string, fallback: [string, string] = ['Yes', 'No']): [string, string] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as string[];
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return [String(parsed[0]), String(parsed[1])];
    }
  } catch {
    // ignore malformed API payloads
  }
  return fallback;
}

function parsePriceArray(raw?: string): [number, number] {
  const fallback: [number, number] = [0.5, 0.5];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as string[];
    if (Array.isArray(parsed) && parsed.length >= 2) {
      const yes = Number(parsed[0]);
      const no = Number(parsed[1]);
      if (Number.isFinite(yes) && Number.isFinite(no)) {
        return [yes, no];
      }
    }
  } catch {
    // ignore malformed API payloads
  }
  return fallback;
}

function parseTokenIds(raw?: string): [string, string] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as string[];
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return [String(parsed[0]), String(parsed[1])];
    }
  } catch {
    // ignore malformed API payloads
  }
  return null;
}

function clampProbability(price: number): number {
  return Math.min(0.99, Math.max(0.01, price));
}

function probabilityToMultiplierBps(price: number): number {
  return Math.max(10101, Math.round(10000 / clampProbability(price)));
}

function inferResolvedOutcome(outcomePrices: [number, number], closed: boolean): boolean | null {
  if (!closed) return null;
  const [yesPrice, noPrice] = outcomePrices;
  if (yesPrice >= 0.999 && noPrice <= 0.001) return true;
  if (noPrice >= 0.999 && yesPrice <= 0.001) return false;
  return null;
}

async function fetchCLOBPrice(tokenId: string): Promise<number | null> {
  try {
    const response = await fetch(`${CLOB_API}/price?token_id=${tokenId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ClobPriceResponse;
    const price = payload.price ? Number(payload.price) : NaN;
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function fetchCLOBPriceChange(
  tokenId: string,
  interval: '1d' | '1w',
  fidelity: number,
): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      market: tokenId,
      interval,
      fidelity: String(fidelity),
    });
    const response = await fetch(`${CLOB_API}/prices-history?${params.toString()}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as ClobPriceHistoryResponse;
    const points = Array.isArray(payload.history) ? payload.history : [];
    if (points.length < 2) return null;

    const first = points.find((point) => Number.isFinite(Number(point.p)));
    const last = [...points].reverse().find((point) => Number.isFinite(Number(point.p)));
    if (!first || !last) return null;

    return clampProbability(Number(last.p)) - clampProbability(Number(first.p));
  } catch {
    return null;
  }
}

async function enrichOutcomePrices(
  market: GammaMarket,
  tokenIds: [string, string] | null,
): Promise<{ prices: [number, number]; hasLivePrice: boolean }> {
  if (!tokenIds) {
    return { prices: parsePriceArray(market.outcomePrices), hasLivePrice: false };
  }

  try {
    const [yesPrice, noPrice] = await Promise.all([
      fetchCLOBPrice(tokenIds[0]),
      fetchCLOBPrice(tokenIds[1]),
    ]);

    if (yesPrice !== null && noPrice !== null) {
      return { prices: [yesPrice, noPrice], hasLivePrice: true };
    }
  } catch {
    // fall back to static outcome prices
  }

  return { prices: parsePriceArray(market.outcomePrices), hasLivePrice: false };
}

async function fetchGammaMarkets(active: boolean, closed: boolean, limit: number): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    active: String(active),
    closed: String(closed),
  });
  const response = await fetch(`${GAMMA_API}/markets?${params.toString()}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma API failed with ${response.status}`);
  }

  return (await response.json()) as GammaMarket[];
}

export async function fetchMirrorCandidates(options: FetchMirrorOptions): Promise<MirrorCandidate[]> {
  const queryTerms = normalizeQueryTerms(options.query);
  const fetchLimit = Math.max(options.limit * 3, options.closed ? 100 : 100);
  const now = Date.now();
  const oneFutureMs = options.maxDurationSecs * 1000;

  const markets = await fetchGammaMarkets(options.active, options.closed, fetchLimit);

  const filtered = markets.filter((market) => {
    if (market.archived) return false;
    if (market.active !== options.active) return false;
    if (market.closed !== options.closed) return false;
    if (!matchesQuery(market, queryTerms)) return false;
    if ((market.volumeNum || 0) < options.minVolume) return false;

    if (market.endDate) {
      const endMs = Date.parse(market.endDate);
      if (Number.isFinite(endMs)) {
        if (options.active && endMs <= now) return false;
        if (!options.closed && endMs - now > oneFutureMs) return false;
      }
    }

    return true;
  });

  const enriched = await Promise.all(
    filtered.map(async (market) => {
      const tokenIds = parseTokenIds(market.clobTokenIds);
      const [{ prices, hasLivePrice }, change24h, change1w] = await Promise.all([
        enrichOutcomePrices(market, tokenIds),
        tokenIds ? fetchCLOBPriceChange(tokenIds[0], '1d', 60) : Promise.resolve(null),
        tokenIds ? fetchCLOBPriceChange(tokenIds[0], '1w', 240) : Promise.resolve(null),
      ]);
      const outcomeLabels = parseStringArray(market.outcomes);
      const publicYesPrice = clampProbability(prices[0]);
      const publicNoPrice = clampProbability(prices[1]);
      const yesMultiplierBps = probabilityToMultiplierBps(publicYesPrice);
      const noMultiplierBps = probabilityToMultiplierBps(publicNoPrice);

      const conditionSeed = JSON.stringify({
        question: market.question,
        description: market.description || '',
        endDate: market.endDate || '',
        outcomes: outcomeLabels,
      });
      const sourceHash = hashToField(`polymarket:source:${market.id}`);
      const conditionHash = hashToField(`polymarket:condition:${conditionSeed}`);
      const resolvedOutcome = inferResolvedOutcome([publicYesPrice, publicNoPrice], market.closed);
      const resolutionHash = resolvedOutcome === null
        ? undefined
        : hashToField(
            `polymarket:resolution:${market.id}:${resolvedOutcome ? 'yes' : 'no'}:${publicYesPrice}:${publicNoPrice}:${market.endDate || ''}`
          );

      return {
        source: 'polymarket' as const,
        sourceMarketId: market.id,
        marketId: deriveMirrorMarketId(sourceHash.decimal),
        slug: market.slug,
        question: market.question,
        description: market.description,
        category: market.category || inferCategory(market.question, market.description),
        endDate: market.endDate,
        outcomeLabels,
        outcomePrices: [publicYesPrice, publicNoPrice] as [number, number],
        publicYesPrice,
        publicNoPrice,
        yesMultiplierBps,
        noMultiplierBps,
        volume: market.volumeNum || 0,
        volume24hr: market.volume24hr || 0,
        volume1wk: market.volume1wk || 0,
        yesPriceChange24h: change24h ?? 0,
        yesPriceChange1w: change1w ?? 0,
        liquidity: market.liquidityNum || 0,
        commentCount: market.commentCount || 0,
        hasLivePrice,
        active: market.active,
        closed: market.closed,
        sourceHash: sourceHash.decimal,
        sourceHashField: sourceHash.field,
        conditionHash: conditionHash.decimal,
        conditionHashField: conditionHash.field,
        resolutionHash: resolutionHash?.decimal,
        resolutionHashField: resolutionHash?.field,
        resolvedOutcome,
      };
    })
  );

  return enriched
    .sort((a, b) => (b.volume24hr || b.volume) - (a.volume24hr || a.volume))
    .slice(0, options.limit);
}
