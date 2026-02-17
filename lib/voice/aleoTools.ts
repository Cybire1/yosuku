// Aleo voice tools for prediction market interactions
import type { Market } from '@/components/MarketCard';

export interface VoiceToolResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

// Fetch public balance from Aleo blockchain
async function fetchAleoBalance(address: string): Promise<number> {
  try {
    const response = await fetch('https://api.explorer.provable.com/v1/testnet/program/credits.aleo/mapping/account/' + address);

    if (!response.ok) {
      // Address might not have any credits yet
      if (response.status === 404) return 0;
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    // Aleo returns balance in microcredits (1 ALEO = 1,000,000 microcredits)
    if (data && typeof data === 'string') {
      // Response format: "123456789u64"
      const microcredits = parseInt(data.replace('u64', ''));
      return microcredits / 1_000_000;
    }

    return 0;
  } catch (error) {
    console.error('[Voice] Error fetching Aleo balance:', error);
    throw error;
  }
}

// Get active markets filtered by category
export async function getActiveMarkets(category: string = 'All'): Promise<VoiceToolResult> {
  try {
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];

    let filteredMarkets = markets.filter(m => !m.resolved);

    if (category !== 'All') {
      filteredMarkets = filteredMarkets.filter(m => m.category === category);
    }

    // Sort by volume
    filteredMarkets.sort((a, b) => b.total_volume - a.total_volume);

    if (filteredMarkets.length === 0) {
      return {
        success: true,
        message: `No active markets found${category !== 'All' ? ` in ${category} category` : ''}.`,
        data: []
      };
    }

    // Format for voice response
    const marketList = filteredMarkets.slice(0, 5).map((m, idx) => {
      const yesOdds = ((m.total_yes_shares / (m.total_yes_shares + m.total_no_shares)) * 100).toFixed(0);
      return `${idx + 1}. ${m.question} - ${yesOdds}% YES - ${m.total_volume.toFixed(1)} ALEO volume`;
    }).join('\n');

    return {
      success: true,
      message: `Found ${filteredMarkets.length} active markets${category !== 'All' ? ` in ${category}` : ''}:\n${marketList}`,
      data: filteredMarkets
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to fetch markets',
      error: error.message
    };
  }
}

// Get trending markets by volume
export async function getTrendingMarkets(): Promise<VoiceToolResult> {
  try {
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];

    const activeMarkets = markets.filter(m => !m.resolved);

    // Sort by volume (descending)
    const trending = activeMarkets
      .sort((a, b) => b.total_volume - a.total_volume)
      .slice(0, 3);

    if (trending.length === 0) {
      return {
        success: true,
        message: 'No trending markets found.',
        data: []
      };
    }

    const trendingList = trending.map((m, idx) => {
      const yesOdds = ((m.total_yes_shares / (m.total_yes_shares + m.total_no_shares)) * 100).toFixed(0);
      return `${idx + 1}. ${m.question} - ${yesOdds}% YES - ${m.total_volume.toFixed(1)} ALEO volume`;
    }).join('\n');

    return {
      success: true,
      message: `Top trending markets:\n${trendingList}`,
      data: trending
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to fetch trending markets',
      error: error.message
    };
  }
}

// Get market details by ID
export async function getMarketDetails(marketId: number): Promise<VoiceToolResult> {
  try {
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];
    const market = markets.find(m => m.id === marketId);

    if (!market) {
      return {
        success: false,
        message: `Market ${marketId} not found.`,
        error: 'Market not found'
      };
    }

    const totalShares = market.total_yes_shares + market.total_no_shares;
    const yesOdds = totalShares > 0 ? ((market.total_yes_shares / totalShares) * 100).toFixed(0) : '50';
    const noOdds = totalShares > 0 ? ((market.total_no_shares / totalShares) * 100).toFixed(0) : '50';

    const endDate = new Date(market.end_timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const yesPayout = totalShares > 0 ? (totalShares / market.total_yes_shares).toFixed(2) : '2.00';
    const noPayout = totalShares > 0 ? (totalShares / market.total_no_shares).toFixed(2) : '2.00';

    const message = `Market ${marketId}: ${market.question}
Status: ${market.resolved ? 'Resolved' : 'Active'}
Odds: ${yesOdds}% YES, ${noOdds}% NO
Volume: ${market.total_volume.toFixed(1)} ALEO
Ends: ${endDate}
If you bet 1 ALEO on YES, you'd win ${yesPayout} ALEO total.
If you bet 1 ALEO on NO, you'd win ${noPayout} ALEO total.`;

    return {
      success: true,
      message,
      data: market
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to fetch market details',
      error: error.message
    };
  }
}

// Get user's wallet balance
export async function getWalletBalance(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Wallet not connected. Please connect your Leo wallet first.',
        error: 'No wallet connected'
      };
    }

    // Fetch real on-chain balance
    let totalBalance = 0;
    try {
      totalBalance = await fetchAleoBalance(publicKey);
    } catch (balanceError) {
      console.error('[Voice] Could not fetch on-chain balance:', balanceError);
      // Continue with staked-only info if blockchain fetch fails
    }

    // Get staked amounts from positions
    const positions = JSON.parse(localStorage.getItem(`positions_${publicKey}`) || '[]');
    const totalStaked = positions.reduce((sum: number, p: any) => sum + p.shares, 0);

    // Count active positions
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]');
    const activePositions = positions.filter((p: any) => {
      const market = markets.find((m: any) => m.id.toString() === p.marketId);
      return market && !market.resolved;
    });

    // Calculate available balance
    const available = totalBalance - totalStaked;

    let message = '';
    if (totalBalance > 0) {
      message = `Your wallet balance:\n\nTotal: ${totalBalance.toFixed(2)} ALEO\nStaked in markets: ${totalStaked.toFixed(2)} ALEO\nAvailable: ${available.toFixed(2)} ALEO`;

      if (activePositions.length > 0) {
        message += `\n\nYou have ${activePositions.length} active position${activePositions.length !== 1 ? 's' : ''}.`;
      }
    } else if (totalStaked > 0) {
      // Blockchain balance is 0 but has staked positions (unlikely but handle it)
      message = `You have ${totalStaked.toFixed(2)} ALEO staked across ${activePositions.length} active market${activePositions.length !== 1 ? 's' : ''}.\n\nNote: Your on-chain balance shows 0 ALEO. This might be because positions are in private records.`;
    } else {
      message = `Your balance is 0 ALEO.\n\nGet testnet credits from the Aleo faucet: https://faucet.aleo.org/`;
    }

    return {
      success: true,
      message,
      data: {
        totalBalance,
        staked: totalStaked,
        available,
        activePositionsCount: activePositions.length
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to fetch wallet balance. Please try again.',
      error: error.message
    };
  }
}

// Get user's active positions
export async function getActivePositions(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Wallet not connected. Please connect your Leo wallet first.',
        error: 'No wallet connected'
      };
    }

    const positions = JSON.parse(localStorage.getItem(`positions_${publicKey}`) || '[]');
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];

    if (positions.length === 0) {
      return {
        success: true,
        message: 'You have no active positions.',
        data: []
      };
    }

    const positionDetails = positions.map((p: any, idx: number) => {
      const market = markets.find(m => m.id.toString() === p.marketId);
      if (!market) return null;

      const totalShares = market.total_yes_shares + market.total_no_shares;
      const currentOdds = totalShares > 0
        ? ((p.side === 'YES' ? market.total_yes_shares : market.total_no_shares) / totalShares * 100).toFixed(0)
        : '50';

      return `${idx + 1}. ${market.question.slice(0, 50)}... - ${p.shares} ALEO on ${p.side} (${currentOdds}% odds)`;
    }).filter(Boolean);

    const totalAtRisk = positions.reduce((sum: number, p: any) => sum + p.shares, 0);
    const potentialWinnings = positions.reduce((sum: number, p: any) => sum + (p.shares * 2), 0);

    return {
      success: true,
      message: `You have ${positions.length} active positions:\n${positionDetails.join('\n')}\n\nTotal at risk: ${totalAtRisk.toFixed(2)} ALEO\nPotential winnings: ${potentialWinnings.toFixed(2)} ALEO`,
      data: positions
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to fetch active positions',
      error: error.message
    };
  }
}

// PHASE 2: TRADING ACTIONS

// Prepare bet (validation only, returns confirmation data)
export async function prepareBet(
  publicKey: string | undefined,
  marketId: number,
  side: 'YES' | 'NO',
  amount: number
): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Please connect your wallet first to place bets.',
        error: 'No wallet connected'
      };
    }

    // Validate amount
    if (amount <= 0) {
      return {
        success: false,
        message: 'Bet amount must be greater than 0 ALEO.',
        error: 'Invalid amount'
      };
    }

    // Check balance
    let totalBalance = 0;
    try {
      totalBalance = await fetchAleoBalance(publicKey);
    } catch (e) {
      console.error('[Voice] Balance check failed:', e);
    }

    const positions = JSON.parse(localStorage.getItem(`positions_${publicKey}`) || '[]');
    const totalStaked = positions.reduce((sum: number, p: any) => sum + p.shares, 0);
    const available = totalBalance - totalStaked;

    if (amount > available) {
      return {
        success: false,
        message: `Insufficient balance. You have ${available.toFixed(2)} ALEO available, but you're trying to bet ${amount} ALEO.`,
        error: 'Insufficient balance'
      };
    }

    // Get market details
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];
    const market = markets.find(m => m.id === marketId);

    if (!market) {
      return {
        success: false,
        message: `Market ${marketId} not found.`,
        error: 'Market not found'
      };
    }

    if (market.resolved) {
      return {
        success: false,
        message: `Market ${marketId} is already resolved. You can't place new bets.`,
        error: 'Market resolved'
      };
    }

    // Check if market has ended
    const now = Math.floor(Date.now() / 1000);
    if (market.end_timestamp < now) {
      return {
        success: false,
        message: `Market ${marketId} has ended. You can't place new bets.`,
        error: 'Market ended'
      };
    }

    // Calculate expected payout
    const totalShares = market.total_yes_shares + market.total_no_shares;
    const newTotalShares = totalShares + amount;
    const sideShares = side === 'YES' ? market.total_yes_shares : market.total_no_shares;
    const newSideShares = sideShares + amount;

    const expectedPayout = (newTotalShares / newSideShares) * amount;
    const currentOdds = totalShares > 0 ? ((sideShares / totalShares) * 100).toFixed(0) : '50';
    const newOdds = ((newSideShares / newTotalShares) * 100).toFixed(0);

    const confirmationMessage = `Ready to place bet:

Market: ${market.question}
Side: ${side}
Amount: ${amount} ALEO
Current odds: ${currentOdds}% ${side}
New odds after bet: ${newOdds}% ${side}
Expected payout if you win: ${expectedPayout.toFixed(2)} ALEO
Profit if you win: ${(expectedPayout - amount).toFixed(2)} ALEO

Say "confirm" to place this bet, or "cancel" to abort.`;

    return {
      success: true,
      message: confirmationMessage,
      data: {
        marketId,
        side,
        amount,
        market,
        expectedPayout,
        currentOdds,
        newOdds,
        confirmed: false
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to prepare bet. Please try again.',
      error: error.message
    };
  }
}

// Smart recommendations based on user's portfolio
export async function getSmartRecommendations(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Please connect your wallet to get personalized recommendations.',
        error: 'No wallet connected'
      };
    }

    const positions = JSON.parse(localStorage.getItem(`positions_${publicKey}`) || '[]');
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];
    const activeMarkets = markets.filter(m => !m.resolved);

    // Analyze user's betting patterns
    const userCategories: Record<string, number> = {};
    const userSides: Record<string, number> = { YES: 0, NO: 0 };

    positions.forEach((p: any) => {
      const market = markets.find(m => m.id.toString() === p.marketId);
      if (market && !market.resolved) {
        const cat = market.category ?? 'Other';
        userCategories[cat] = (userCategories[cat] || 0) + 1;
        userSides[p.side] = (userSides[p.side] || 0) + 1;
      }
    });

    const favoriteCategory = Object.entries(userCategories).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Find high-volume markets user hasn't bet on
    const recommendations = activeMarkets
      .filter(m => {
        // User hasn't bet on this market
        const hasPosition = positions.some((p: any) => p.marketId === m.id.toString());
        return !hasPosition && m.total_volume > 1; // At least 1 ALEO volume
      })
      .sort((a, b) => b.total_volume - a.total_volume)
      .slice(0, 3);

    if (recommendations.length === 0) {
      return {
        success: true,
        message: favoriteCategory
          ? `You've bet on all high-volume ${favoriteCategory} markets! Check back later for new opportunities.`
          : 'No new recommendations at the moment. Try creating a market or explore different categories!',
        data: []
      };
    }

    const recList = recommendations.map((m, idx) => {
      const totalShares = m.total_yes_shares + m.total_no_shares;
      const yesOdds = ((m.total_yes_shares / totalShares) * 100).toFixed(0);
      const noOdds = ((m.total_no_shares / totalShares) * 100).toFixed(0);

      // Suggest underdog if user tends to bet on favorites
      const suggestion = parseInt(yesOdds) > 60 ? 'NO' : 'YES';

      return `${idx + 1}. ${m.question} (${m.category})
   Current odds: ${yesOdds}% YES, ${noOdds}% NO
   Volume: ${m.total_volume.toFixed(1)} ALEO
   Suggestion: Consider ${suggestion} - underdog opportunity`;
    }).join('\n\n');

    let message = 'Smart recommendations based on your portfolio:\n\n';
    if (favoriteCategory) {
      message += `You seem to like ${favoriteCategory} markets! Here are some opportunities:\n\n`;
    }
    message += recList;

    return {
      success: true,
      message,
      data: recommendations
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to generate recommendations.',
      error: error.message
    };
  }
}

// Portfolio performance analysis
export async function analyzePortfolio(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Please connect your wallet to analyze your portfolio.',
        error: 'No wallet connected'
      };
    }

    const positions = JSON.parse(localStorage.getItem(`positions_${publicKey}`) || '[]');
    const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]') as Market[];

    if (positions.length === 0) {
      return {
        success: true,
        message: 'You have no positions yet. Start by exploring trending markets!',
        data: {}
      };
    }

    // Calculate portfolio metrics
    const totalInvested = positions.reduce((sum: number, p: any) => sum + p.shares, 0);

    let winningPositions = 0;
    let losingPositions = 0;
    let unresolvedPositions = 0;
    let totalValue = 0;

    positions.forEach((p: any) => {
      const market = markets.find(m => m.id.toString() === p.marketId);
      if (!market) return;

      if (market.resolved) {
        if (market.winning_side === p.side) {
          winningPositions++;
          totalValue += p.shares * 2; // Approximate 2x payout
        } else {
          losingPositions++;
        }
      } else {
        unresolvedPositions++;
        // Calculate current value based on odds
        const totalShares = market.total_yes_shares + market.total_no_shares;
        const currentPayout = (totalShares / (p.side === 'YES' ? market.total_yes_shares : market.total_no_shares)) * p.shares;
        totalValue += currentPayout;
      }
    });

    const roi = totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested * 100).toFixed(1) : '0.0';
    const winRate = (winningPositions + losingPositions) > 0
      ? ((winningPositions / (winningPositions + losingPositions)) * 100).toFixed(0)
      : '0';

    const message = `Portfolio Analysis:

Total Positions: ${positions.length}
Active: ${unresolvedPositions}
Resolved: ${winningPositions + losingPositions} (${winningPositions} wins, ${losingPositions} losses)

Total Invested: ${totalInvested.toFixed(2)} ALEO
Current Value: ${totalValue.toFixed(2)} ALEO
Profit/Loss: ${(totalValue - totalInvested).toFixed(2)} ALEO
ROI: ${roi}%
Win Rate: ${winRate}%

${parseFloat(roi) > 0 ? '🎉 Great job! You\'re making profits!' : parseFloat(roi) < 0 ? '📊 Keep learning and improve your strategy!' : '📈 You\'re breaking even. Consider diversifying!'}`;

    return {
      success: true,
      message,
      data: {
        totalPositions: positions.length,
        activePositions: unresolvedPositions,
        resolvedPositions: winningPositions + losingPositions,
        winningPositions,
        losingPositions,
        totalInvested,
        totalValue,
        profitLoss: totalValue - totalInvested,
        roi: parseFloat(roi),
        winRate: parseFloat(winRate)
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to analyze portfolio.',
      error: error.message
    };
  }
}
