import type {
  LeaderboardEntry,
  SignalGroup,
  TraderBet,
  UserPosition,
} from "./types";
import {
  fetchLeaderboard,
  fetchSportsEventSlugs,
  fetchUserPositions,
  mapWithConcurrency,
} from "./polymarket";

export interface BuildSignalsOptions {
  /** How many top leaderboard traders to pull. */
  topN?: number;
  /** Minimum number of traders on the same market+outcome to qualify as a signal. */
  minTraders?: number;
  /** Ignore positions with currentValue below this (filters out dust/closed positions). */
  minPositionValue?: number;
  /** Concurrency for per-trader position fetches. */
  concurrency?: number;
  /** Hide markets where the outcome price is >= 0.99 (effectively already resolved). */
  hideResolved?: boolean;
  /** Only include markets tagged as sports or esports on Polymarket. */
  sportsOnly?: boolean;
}

export interface SignalsPayload {
  signals: SignalGroup[];
  meta: {
    topN: number;
    minTraders: number;
    tradersAnalyzed: number;
    totalPositions: number;
    hideResolved: boolean;
    resolvedHidden: number;
    sportsOnly: boolean;
    nonSportsHidden: number;
    generatedAt: string;
  };
}

/**
 * Build the list of "follow-the-smart-money" signals:
 *   1. Pull top N monthly-profit traders.
 *   2. Fetch each trader's current positions.
 *   3. Group by (conditionId, outcomeIndex) — same market, same side.
 *   4. Keep groups with >= minTraders unique traders.
 *   5. Drop markets already resolved (price >= 99¢) unless hideResolved=false.
 *   6. Sort by average position value (USD) descending.
 */
export async function buildSignals(
  options: BuildSignalsOptions = {}
): Promise<SignalsPayload> {
  const topN = Math.min(Math.max(options.topN ?? 50, 1), 1000);
  const minTraders = Math.max(options.minTraders ?? 3, 2);
  const minPositionValue = options.minPositionValue ?? 50; // ignore <$50 dust
  // Scale concurrency up with topN so 500-trader runs don't take forever,
  // but stay bounded so we don't trip Polymarket's rate limits.
  const defaultConcurrency = topN > 200 ? 10 : topN > 75 ? 8 : 6;
  const concurrency = Math.min(
    Math.max(options.concurrency ?? defaultConcurrency, 1),
    12
  );
  const hideResolved = options.hideResolved ?? true;
  const sportsOnly = options.sportsOnly ?? false;
  // Markets trading at >= 99¢ are effectively resolved — nothing to follow.
  const RESOLVED_PRICE_THRESHOLD = 0.99;

  // Kick off the sports-slug fetch in parallel with the leaderboard so the
  // extra Gamma call doesn't serialize behind the data-API call. Resolves to
  // an empty Set when the toggle is off — cheap, no network cost.
  const sportsSlugsPromise: Promise<Set<string>> = sportsOnly
    ? fetchSportsEventSlugs()
    : Promise.resolve(new Set<string>());

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

  // Wait for the sports-slug set now that grouping is done. When sportsOnly is
  // false this resolves instantly with an empty set (see promise init above).
  const sportsSlugs = await sportsSlugsPromise;

  // Finalize: compute aggregates, filter by minTraders + resolved + sports, sort.
  const signals: SignalGroup[] = [];
  let resolvedHidden = 0;
  let nonSportsHidden = 0;
  for (const group of groups.values()) {
    if (group.traders.length < minTraders) continue;
    if (group.currentPrice >= RESOLVED_PRICE_THRESHOLD) {
      resolvedHidden++;
      if (hideResolved) continue;
    }
    if (sportsOnly) {
      const slug = group.eventSlug?.toLowerCase();
      if (!slug || !sportsSlugs.has(slug)) {
        nonSportsHidden++;
        continue;
      }
    }

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
      hideResolved,
      resolvedHidden,
      sportsOnly,
      nonSportsHidden,
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
