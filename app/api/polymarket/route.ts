import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '12';
    const active = searchParams.get('active') || 'true';

    // Fetch more markets initially to have better selection
    const fetchLimit = Math.max(parseInt(limit) * 4, 50);

    // Fetch from Polymarket Gamma API (Market metadata)
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?limit=${fetchLimit}&active=${active}&closed=false`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        next: { revalidate: 60 }, // Cache for 1 minute (more frequent for live data)
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch from Polymarket Gamma API');
    }

    const markets = await response.json();

    // Function to fetch real-time price from CLOB API
    const fetchCLOBPrice = async (tokenId: string) => {
      try {
        const clobResponse = await fetch(
          `https://clob.polymarket.com/price?token_id=${tokenId}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
            next: { revalidate: 30 }, // Cache for 30 seconds (very fresh data)
          }
        );

        if (clobResponse.ok) {
          const priceData = await clobResponse.json();
          return priceData.price || null;
        }
      } catch (error) {
        console.error(`CLOB API error for token ${tokenId}:`, error);
      }
      return null;
    };

    // Filter and transform data to match our format
    const now = new Date();
    const filteredMarkets = markets.filter((market: any) => {
      // Check if market has ended
      const endDate = market.endDate ? new Date(market.endDate) : null;
      const hasEnded = endDate && endDate < now;

      // Only show active, open markets with decent volume that haven't ended
      return (
        market.active &&
        !market.closed &&
        !market.archived &&
        !hasEnded &&
        market.volumeNum > 50 // Lower threshold to get more markets
      );
    }).slice(0, parseInt(limit) * 3); // Get 3x markets initially for better selection

    // Enrich with CLOB real-time pricing (parallel fetches for speed)
    const enrichedMarkets = await Promise.all(
      filteredMarkets.map(async (market: any) => {
        let livePrices = null;

        // Try to get live prices from CLOB API if we have token IDs
        if (market.clobTokenIds) {
          try {
            const tokenIds = JSON.parse(market.clobTokenIds);
            if (tokenIds && tokenIds.length >= 2) {
              // Fetch both YES and NO token prices in parallel
              const [yesPrice, noPrice] = await Promise.all([
                fetchCLOBPrice(tokenIds[0]),
                fetchCLOBPrice(tokenIds[1]),
              ]);

              if (yesPrice !== null && noPrice !== null) {
                livePrices = [yesPrice, noPrice];
              }
            }
          } catch (err) {
            console.error('Error parsing token IDs:', err);
          }
        }

        // Use live prices if available, otherwise fall back to static prices
        const outcomePrices = livePrices ||
          (market.outcomePrices ? JSON.parse(market.outcomePrices) : ['0.5', '0.5']);

        return {
          id: market.id,
          question: market.question,
          description: market.description,
          endDate: market.endDate,
          category: market.category || 'Other',
          volume: market.volumeNum || 0,
          liquidity: market.liquidityNum || 0,
          image: market.image,
          icon: market.icon,
          outcomePrices, // Live prices from CLOB or static from Gamma
          outcomes: market.outcomes ? JSON.parse(market.outcomes) : ['Yes', 'No'],
          slug: market.slug,
          volume24hr: market.volume24hr || 0,
          volume1wk: market.volume1wk || 0,
          hasLivePrice: livePrices !== null, // Flag to show if using real-time data
          // Additional metadata
          liquidity24hr: market.liquidityNum || 0,
          createdAt: market.createdAt,
          commentCount: market.commentCount || 0,
        };
      })
    );

    // Filter out markets that end too far in the future (> 1 year) to focus on near-term events
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const nearTermMarkets = enrichedMarkets.filter(market => {
      if (!market.endDate) return true; // Include markets without end dates
      const endDate = new Date(market.endDate);
      return endDate <= oneYearFromNow; // Only markets ending within 1 year
    });

    // Sort by 24hr volume and take top N
    const sortedMarkets = nearTermMarkets
      .sort((a, b) => (b.volume24hr || b.volume) - (a.volume24hr || a.volume))
      .slice(0, parseInt(limit));

    return NextResponse.json({
      success: true,
      markets: sortedMarkets,
      count: sortedMarkets.length,
      meta: {
        gammaApi: 'https://gamma-api.polymarket.com',
        clobApi: 'https://clob.polymarket.com',
        cacheDuration: '60s',
      },
    });
  } catch (error: any) {
    console.error('Polymarket API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch markets' },
      { status: 500 }
    );
  }
}
