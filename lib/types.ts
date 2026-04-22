// Polymarket Data-API response types.
// Source: https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings
// and     https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user

export type LeaderboardTimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";
export type LeaderboardOrderBy = "PNL" | "VOL";

export interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol?: number;
  pnl?: number;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

export interface UserPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable?: boolean;
  title: string;
  slug: string;
  icon?: string;
  eventSlug?: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;
  endDate?: string;
  negativeRisk?: boolean;
}

// ---- Derived / application types ----

export interface TraderBet {
  proxyWallet: string;
  userName: string;
  profileImage?: string;
  pnl?: number;
  rank: string;
  positionValue: number; // currentValue in USD
  shares: number; // size
  avgPrice: number;
  currentPrice: number;
}

export interface SignalGroup {
  conditionId: string;
  marketTitle: string;
  marketSlug: string;
  eventSlug?: string;
  icon?: string;
  outcome: string;
  outcomeIndex: number;
  currentPrice: number;
  endDate?: string;
  traders: TraderBet[];
  traderCount: number;
  avgPositionValue: number;
  totalPositionValue: number;
}
