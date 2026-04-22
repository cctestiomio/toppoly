import type {
  LeaderboardEntry,
  SignalGroup,
  TraderBet,
  UserPosition,
} from "./types";
import {
  fetchLeaderboard,
  fetchUserPositions,
  mapWithConcurrency,
} from "./polymarket";

export interface BuildSignalsOptions {
  /** How many top leaderboard traders to pull. API cap is 50. */
  topN?: number;
  /** Minimum number of traders on the same market+outcome to qualify as a signal. */
  minTraders?: number;
  /** Ignore positions with currentValue below this (filters out dust/closed positions). */
  minPositionValue?: number;
  /** Concurrency for per-trader position fetches. */
  concurrency?: number;
}

export interface SignalsPayload {
  signals: SignalGroup[];
  meta: {
    topN: number;
    minTraders: number;
    tradersAnalyzed: number;
    totalPositions: number;
    generatedAt: string;
  };
}

/**
 * Build the list of "follow-the-smart-money" signals:
 *   1. Pull top N monthly-profit traders.
 *   2. Fetch each trader's current positions.
 *   3. Group by (conditionId, outcomeIndex) — same market, same side.
 *   4. Keep groups with >= minTraders unique traders.
 *   5. Sort by average position value (USD) descending.
 */
export async function buildSignals(
  options: BuildSignalsOptions = {}
): Promise<SignalsPayload> {
  const topN = Math.min(Math.max(options.topN ?? 50, 1), 50);
  const minTraders = Math.max(options.minTraders ?? 3, 2);
  const minPositionValue = options.minPositionValue ?? 50; // ignore <$50 dust
  const concurrency = Math.min(Math.max(options.concurrency ?? 6, 1), 10);

  const leaderboard = await fetchLeaderboard({
    timePeriod: "MONTH",
    orderBy: "PNL",
    limit: topN,
  });

  // Index leaderboard entries by wallet for quick lookup when we build traders.
  const leaderboardByWallet = new Map<string, LeaderboardEntry>();
  for (const entry of leaderboard) {
    if (entry.proxyWallet) {
      leaderboardByWallet.set(entry.proxyWallet.toLowerCase(), entry);
    }
  }

  // Fetch positions for each trader in parallel (bounded).
  const allTradersPositions = await mapWithConcurrency(
    leaderboard,
    concurrency,
    async (entry) => {
      const positions = await fetchUserPositions(entry.proxyWallet);
      return { entry, positions };
    }
  );

  // Group positions by marketKey = conditionId + ":" + outcomeIndex
  // so that "YES on market X" and "NO on market X" are different signals.
  const groups = new Map<string, SignalGroup>();
  let totalPositions = 0;

  for (const { entry, positions } of allTradersPositions) {
    for (const pos of positions) {
      totalPositions++;

      if (!pos.conditionId || typeof pos.outcomeIndex !== "number") continue;
      if (pos.currentValue < minPositionValue) continue;

      const key = `${pos.conditionId}:${pos.outcomeIndex}`;
      const lbEntry = leaderboardByWallet.get(entry.proxyWallet.toLowerCase());

      const trader: TraderBet = {
        proxyWallet: entry.proxyWallet,
        userName: displayNameFor(entry),
        profileImage: entry.profileImage,
        pnl: lbEntry?.pnl,
        rank: entry.rank,
        positionValue: pos.currentValue,
        shares: pos.size,
        avgPrice: pos.avgPrice,
        currentPrice: pos.curPrice,
      };

      let group = groups.get(key);
      if (!group) {
        group = initGroup(pos);
        groups.set(key, group);
      }

      // Deduplicate: one trader should appear once per market+outcome group.
      if (!group.traders.some((t) => t.proxyWallet === trader.proxyWallet)) {
        group.traders.push(trader);
      }
    }
  }

  // Finalize: compute aggregates, filter by minTraders, sort.
  const signals: SignalGroup[] = [];
  for (const group of groups.values()) {
    if (group.traders.length < minTraders) continue;

    const total = group.traders.reduce((s, t) => s + t.positionValue, 0);
    group.totalPositionValue = total;
    group.avgPositionValue = total / group.traders.length;
    group.traderCount = group.traders.length;

    // Show the biggest positions first inside each signal.
    group.traders.sort((a, b) => b.positionValue - a.positionValue);
    signals.push(group);
  }

  signals.sort((a, b) => b.avgPositionValue - a.avgPositionValue);

  return {
    signals,
    meta: {
      topN,
      minTraders,
      tradersAnalyzed: leaderboard.length,
      totalPositions,
      generatedAt: new Date().toISOString(),
    },
  };
}

function initGroup(pos: UserPosition): SignalGroup {
  return {
    conditionId: pos.conditionId,
    marketTitle: pos.title,
    marketSlug: pos.slug,
    eventSlug: pos.eventSlug,
    icon: pos.icon,
    outcome: pos.outcome,
    outcomeIndex: pos.outcomeIndex,
    currentPrice: pos.curPrice,
    endDate: pos.endDate,
    traders: [],
    traderCount: 0,
    avgPositionValue: 0,
    totalPositionValue: 0,
  };
}

function displayNameFor(entry: LeaderboardEntry): string {
  if (entry.userName && entry.userName.trim().length > 0) return entry.userName;
  if (entry.proxyWallet) {
    const w = entry.proxyWallet;
    return `${w.slice(0, 6)}…${w.slice(-4)}`;
  }
  return "Anonymous";
}
