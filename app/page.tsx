import Link from "next/link";
import { buildSignals } from "@/lib/signals";
import { formatRelativeTime, formatUsd } from "@/lib/format";
import { SignalCard } from "@/components/SignalCard";

// Underlying fetches use `next: { revalidate: 600 }` so the leaderboard + positions
// calls are cached server-side for 10 minutes regardless of the page-level dynamic
// rendering needed for searchParams-based filters.

interface PageProps {
  searchParams?: {
    min?: string;
    top?: string;
    resolved?: string;
  };
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export default async function Page({ searchParams }: PageProps) {
  const minTraders = parsePositiveInt(searchParams?.min, 3, 2, 10);
  const topN = parsePositiveInt(searchParams?.top, 50, 10, 50);
  // Default to hiding resolved markets; ?resolved=1 shows them.
  const hideResolved = searchParams?.resolved !== "1";

  let errorMessage: string | null = null;
  let payload: Awaited<ReturnType<typeof buildSignals>> | null = null;

  try {
    payload = await buildSignals({ topN, minTraders, hideResolved });
  } catch (err) {
    errorMessage =
      err instanceof Error
        ? err.message
        : "Unknown error loading Polymarket data.";
  }

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12">
      <Header
        topN={topN}
        minTraders={minTraders}
        generatedAt={payload?.meta.generatedAt}
      />

      <FilterBar
        currentMin={minTraders}
        currentTop={topN}
        hideResolved={hideResolved}
      />

      {errorMessage && (
        <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <strong className="font-semibold">Couldn&apos;t load signals:</strong>{" "}
          {errorMessage}
          <p className="mt-2 text-rose-700">
            Polymarket&apos;s API may be rate-limiting or temporarily down.
            Refresh in a moment.
          </p>
        </div>
      )}

      {payload && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-600">
            <span>
              <strong className="text-neutral-900">
                {payload.signals.length}
              </strong>{" "}
              {payload.signals.length === 1 ? "signal" : "signals"} found
            </span>
            <span>
              from{" "}
              <strong className="text-neutral-900">
                {payload.meta.tradersAnalyzed}
              </strong>{" "}
              top monthly traders
            </span>
            <span>
              across{" "}
              <strong className="text-neutral-900">
                {payload.meta.totalPositions.toLocaleString()}
              </strong>{" "}
              positions
            </span>
            {hideResolved && payload.meta.resolvedHidden > 0 && (
              <span className="text-neutral-500">
                · hiding{" "}
                <strong className="text-neutral-700">
                  {payload.meta.resolvedHidden}
                </strong>{" "}
                resolved
              </span>
            )}
          </div>

          {payload.signals.length === 0 ? (
            <EmptyState minTraders={minTraders} />
          ) : (
            <div className="mt-6 space-y-3">
              {payload.signals.map((signal, i) => (
                <SignalCard
                  key={`${signal.conditionId}:${signal.outcomeIndex}`}
                  signal={signal}
                  index={i}
                />
              ))}
            </div>
          )}

          {payload.signals.length > 0 && (
            <LegendFooter
              topSignalAvg={payload.signals[0]?.avgPositionValue ?? 0}
            />
          )}
        </>
      )}
    </main>
  );
}

function Header({
  topN,
  minTraders,
  generatedAt,
}: {
  topN: number;
  minTraders: number;
  generatedAt?: string;
}) {
  return (
    <header className="border-b border-neutral-200 pb-6">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Polymarket Smart Money
      </div>
      <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-neutral-900 tracking-tight">
        Where the top traders are piling in
      </h1>
      <p className="mt-3 text-neutral-600 max-w-2xl leading-relaxed">
        Markets where{" "}
        <strong className="text-neutral-900">{minTraders}+</strong> of the top{" "}
        <strong className="text-neutral-900">{topN}</strong> monthly-profit
        traders on{" "}
        <a
          href="https://polymarket.com/leaderboard/overall/monthly/profit"
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-neutral-400 underline-offset-2 hover:text-neutral-900"
        >
          Polymarket&apos;s leaderboard
        </a>{" "}
        hold the same position — sorted by average position size. When the smart
        money agrees, it&apos;s worth a look.
      </p>
      {generatedAt && (
        <p className="mt-3 text-xs text-neutral-500">
          Updated {formatRelativeTime(generatedAt)} · cached for 10 min
        </p>
      )}
    </header>
  );
}

function FilterBar({
  currentMin,
  currentTop,
  hideResolved,
}: {
  currentMin: number;
  currentTop: number;
  hideResolved: boolean;
}) {
  const minOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  const topOptions = [25, 50];

  const buildQuery = (overrides: {
    min?: number;
    top?: number;
    resolved?: "1" | undefined;
  }): Record<string, string> => {
    const q: Record<string, string> = {
      min: String(overrides.min ?? currentMin),
      top: String(overrides.top ?? currentTop),
    };
    const resolvedFlag =
      "resolved" in overrides
        ? overrides.resolved
        : hideResolved
        ? undefined
        : "1";
    if (resolvedFlag === "1") q.resolved = "1";
    return q;
  };

  return (
    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-neutral-500">Min traders:</span>
        <div className="inline-flex rounded-md border border-neutral-200 bg-white overflow-hidden">
          {minOptions.map((n) => {
            const active = n === currentMin;
            return (
              <Link
                key={n}
                href={{ query: buildQuery({ min: n }) }}
                prefetch={false}
                className={`px-3 py-1.5 tabular-nums font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {n}+
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-neutral-500">Top traders:</span>
        <div className="inline-flex rounded-md border border-neutral-200 bg-white overflow-hidden">
          {topOptions.map((n) => {
            const active = n === currentTop;
            return (
              <Link
                key={n}
                href={{ query: buildQuery({ top: n }) }}
                prefetch={false}
                className={`px-3 py-1.5 tabular-nums font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {n}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-neutral-500">Resolved:</span>
        <Link
          href={{ query: buildQuery({ resolved: hideResolved ? "1" : undefined }) }}
          prefetch={false}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border font-medium transition-colors ${
            hideResolved
              ? "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              : "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
          }`}
          aria-pressed={!hideResolved}
        >
          <span
            className={`h-4 w-7 rounded-full relative transition-colors ${
              hideResolved ? "bg-neutral-300" : "bg-emerald-400"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                hideResolved ? "left-0.5" : "left-3.5"
              }`}
            />
          </span>
          {hideResolved ? "Hidden" : "Shown"}
        </Link>
      </div>
    </div>
  );
}

function EmptyState({ minTraders }: { minTraders: number }) {
  return (
    <div className="mt-8 rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
      <h2 className="text-lg font-semibold text-neutral-900">
        No clusters yet
      </h2>
      <p className="mt-2 text-sm text-neutral-600 max-w-md mx-auto">
        No markets currently have {minTraders} or more top-50 monthly traders on
        the same side. Try lowering the minimum-trader threshold above.
      </p>
    </div>
  );
}

function LegendFooter({ topSignalAvg }: { topSignalAvg: number }) {
  return (
    <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500 leading-relaxed space-y-2">
      <p>
        <strong className="text-neutral-700">Avg position</strong> is the mean
        USD value of each listed trader&apos;s current position on that
        market+side. Top signal right now: {formatUsd(topSignalAvg)}.
      </p>
      <p>
        Data from Polymarket&apos;s public data-API. This tool is informational
        only and is not financial advice. Always do your own research.
      </p>
    </footer>
  );
}
