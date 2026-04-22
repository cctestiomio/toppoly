import type {
  LeaderboardEntry,
  LeaderboardOrderBy,
  LeaderboardTimePeriod,
  UserPosition,
} from "./types";

const LEADERBOARD_URL = "https://data-api.polymarket.com/v1/leaderboard";
const POSITIONS_URL = "https://data-api.polymarket.com/positions";

// Next.js fetch revalidation window for both endpoints (seconds).
const REVALIDATE_SECONDS = 600; // 10 minutes

/**
 * Fetch the top traders leaderboard.
 *
 * Defaults to MONTHLY PNL which matches:
 *   https://polymarket.com/leaderboard/overall/monthly/profit
 */
export async function fetchLeaderboard(opts?: {
  timePeriod?: LeaderboardTimePeriod;
  orderBy?: LeaderboardOrderBy;
  limit?: number;
}): Promise<LeaderboardEntry[]> {
  const timePeriod = opts?.timePeriod ?? "MONTH";
  const orderBy = opts?.orderBy ?? "PNL";
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 50); // API max = 50

  const url = new URL(LEADERBOARD_URL);
  url.searchParams.set("timePeriod", timePeriod);
  url.searchParams.set("orderBy", orderBy);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("category", "OVERALL");

  const res = await fetch(url.toString(), {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Leaderboard fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as LeaderboardEntry[];
  if (!Array.isArray(data)) {
    throw new Error("Leaderboard response was not an array");
  }
  return data;
}

/**
 * Fetch all current positions for a single user/wallet.
 * Only returns positions above sizeThreshold (default 1 share).
 */
export async function fetchUserPositions(
  proxyWallet: string,
  opts?: { limit?: number; sizeThreshold?: number }
): Promise<UserPosition[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
  const sizeThreshold = opts?.sizeThreshold ?? 1;

  const url = new URL(POSITIONS_URL);
  url.searchParams.set("user", proxyWallet);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sizeThreshold", String(sizeThreshold));
  url.searchParams.set("sortBy", "CURRENT");
  url.searchParams.set("sortDirection", "DESC");

  const res = await fetch(url.toString(), {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    // Individual user fetches may fail (private profile, rate limit, etc.) —
    // we want the pipeline to keep going, not crash the whole request.
    return [];
  }

  try {
    const data = (await res.json()) as UserPosition[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Run an async map with bounded concurrency so we don't get rate-limited
 * when hitting /positions once per trader.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item, i);
    }
  });

  await Promise.all(workers);
  return results;
}
