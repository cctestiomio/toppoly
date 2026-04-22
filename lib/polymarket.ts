import type {
  LeaderboardEntry,
  LeaderboardOrderBy,
  LeaderboardTimePeriod,
  UserPosition,
} from "./types";

const LEADERBOARD_URL = "https://data-api.polymarket.com/v1/leaderboard";
const POSITIONS_URL = "https://data-api.polymarket.com/positions";
const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";

// Next.js fetch revalidation window for both endpoints (seconds).
const REVALIDATE_SECONDS = 600; // 10 minutes

// Polymarket's leaderboard endpoint caps `limit` at 50 per request.
const LEADERBOARD_PAGE_SIZE = 50;
// And caps `offset` at 1000, so the absolute max we can fetch is ~1000 traders.
const LEADERBOARD_MAX_TRADERS = 1000;

// Gamma /events caps `limit` at 100 per page.
const GAMMA_EVENTS_PAGE_SIZE = 100;
// Cap total sports events we pull — a few thousand is plenty to catch every
// market the leaderboard traders might hold. Prevents runaway pagination if the
// API ever returns more than expected.
const GAMMA_EVENTS_MAX_PAGES = 20;

// Tag slugs used to identify sports & esports events in Polymarket's Gamma API.
// `sports` with related_tags=true pulls the whole sports tree (NFL, NBA, MLB,
// soccer leagues, tennis, etc.). `esports` is a sibling top-level tag that is
// NOT a child of `sports`, so we fetch it separately.
const SPORTS_TAG_SLUGS = ["sports", "esports"] as const;

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

  // Build the list of page requests needed to satisfy `requested`.
  const pages: Array<{ limit: number; offset: number }> = [];
  for (let offset = 0; offset < requested; offset += LEADERBOARD_PAGE_SIZE) {
    pages.push({
      limit: Math.min(LEADERBOARD_PAGE_SIZE, requested - offset),
      offset,
    });
  }

  const pageResults = await Promise.all(
    pages.map((p) => fetchLeaderboardPage({ timePeriod, orderBy, ...p }))
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

// Minimal shape we care about from the Gamma /events response.
// Real events have many more fields — we only read what we need.
interface GammaEventLite {
  slug?: string | null;
}

/**
 * Fetch one page of events for a given tag slug from the Gamma API.
 * Returns whatever the API returns — callers handle pagination.
 */
async function fetchGammaEventsPage(params: {
  tagSlug: string;
  offset: number;
  includeRelated: boolean;
}): Promise<GammaEventLite[]> {
  const url = new URL(GAMMA_EVENTS_URL);
  url.searchParams.set("tag_slug", params.tagSlug);
  if (params.includeRelated) {
    // Pulls child tags (NFL, NBA, tennis, etc.) under `sports`.
    url.searchParams.set("related_tags", "true");
  }
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(GAMMA_EVENTS_PAGE_SIZE));
  url.searchParams.set("offset", String(params.offset));

  const res = await fetch(url.toString(), {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    // Non-fatal — if Gamma is hiccupping we'd rather show all signals than
    // crash the whole page.
    return [];
  }

  try {
    const data = (await res.json()) as GammaEventLite[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Fetch every open-market event slug classified as sports or esports on
 * Polymarket, via the Gamma /events endpoint. Paginates per tag until a short
 * page signals end-of-results.
 *
 * Result is a normalized (lower-cased) Set of eventSlugs suitable for direct
 * membership checks against `UserPosition.eventSlug`.
 */
export async function fetchSportsEventSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();

  // Run the per-tag crawls in parallel — they're independent.
  await Promise.all(
    SPORTS_TAG_SLUGS.map(async (tagSlug) => {
      const includeRelated = tagSlug === "sports";
      for (let page = 0; page < GAMMA_EVENTS_MAX_PAGES; page++) {
        const offset = page * GAMMA_EVENTS_PAGE_SIZE;
        const events = await fetchGammaEventsPage({
          tagSlug,
          offset,
          includeRelated,
        });

        for (const event of events) {
          if (event.slug) slugs.add(event.slug.toLowerCase());
        }

        // Short (or empty) page => we've reached the end for this tag.
        if (events.length < GAMMA_EVENTS_PAGE_SIZE) break;
      }
    })
  );

  return slugs;
}
