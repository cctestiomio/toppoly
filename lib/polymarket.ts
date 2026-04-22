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

// Polymarket's leaderboard endpoint caps `limit` at 50 per request.
const LEADERBOARD_PAGE_SIZE = 50;
// And caps `offset` at 1000, so the absolute max is 1050 traders.
const LEADERBOARD_MAX_TRADERS = 1000;

/**
 * Fetch a single page of the leaderboard (max 50 entries).
 */
async function fetchLeaderboardPage(params: {
  timePeriod: LeaderboardTimePeriod;
  orderBy: LeaderboardOrderBy;
  limit: number;
  offset: number;
}): Promise<LeaderboardEntry[]> {
  const url = new URL(LEADERBOARD_URL);
  url.searchParams.set("timePeriod", params.timePeriod);
  url.searchParams.set("orderBy", params.orderBy);
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("offset", String(params.offset));
  url.searchParams.set("category", "OVERALL");

  const res = await fetch(url.toString(), {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(
      `Leaderboard fetch failed (offset ${params.offset}): ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as LeaderboardEntry[];
  if (!Array.isArray(data)) {
    throw new Error("Leaderboard response was not an array");
  }
  return data;
}

/**
 * Fetch the top traders leaderboard, auto-paginating past the 50-per-page cap.
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
  const requested = Math.min(
    Math.max(opts?.limit ?? 50, 1),
    LEADERBOARD_MAX_TRADERS
  );

  // Build the list of page requests we need to satisfy `requested`.
  const pages: Array<{ limit: number; offset: number }> = [];
  for (let offset = 0; offset < requested; offset += LEADERBOARD_PAGE_SIZE) {
    pages.push({
      limit: Math.min(LEADERBOARD_PAGE_SIZE, requested - offset),
      offset,
    });
  }

  const pageResults = await Promise.all(
    pages.map((p) =>
      fetchLeaderboardPage({ timePeriod, orderBy, ...p })
    )
  );

  // Flatten, then deduplicate by wallet in case pages overlap.
  const seen = new Set<string>();
  const merged: LeaderboardEntry[] = [];
  for (const page of pageResults) {
    for (const entry of page) {
      const key = entry.proxyWallet?.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
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
