"use client";

import { useState } from "react";
import type { SignalGroup } from "@/lib/types";
import {
  formatEndDate,
  formatProbability,
  formatShares,
  formatUsd,
} from "@/lib/format";

interface SignalCardProps {
  signal: SignalGroup;
  index: number;
}

export function SignalCard({ signal, index }: SignalCardProps) {
  const [expanded, setExpanded] = useState(index < 3); // Auto-expand top 3

  const outcomeTone = pickOutcomeTone(signal.outcome);
  const polymarketUrl = signal.eventSlug
    ? `https://polymarket.com/event/${signal.eventSlug}`
    : `https://polymarket.com/market/${signal.marketSlug}`;
  const endDateLabel = formatEndDate(signal.endDate);

  return (
    <article className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <header
        className="flex items-start gap-4 p-5 cursor-pointer hover:bg-neutral-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
      >
        {signal.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signal.icon}
            alt=""
            className="h-12 w-12 rounded-lg bg-neutral-100 object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-neutral-100 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono tabular-nums text-neutral-400">
              #{index + 1}
            </span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${outcomeTone}`}
            >
              {signal.outcome}
            </span>
            <span className="text-xs font-semibold text-neutral-700 tabular-nums">
              @ {formatProbability(signal.currentPrice)}
            </span>
            {endDateLabel && (
              <span className="text-xs text-neutral-500">
                · ends {endDateLabel}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-neutral-900 leading-snug">
            <a
              href={polymarketUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline decoration-neutral-400 underline-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              {signal.marketTitle}
            </a>
          </h3>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            <Stat
              label="Avg position"
              value={formatUsd(signal.avgPositionValue)}
              emphasize
            />
            <Stat
              label="Total"
              value={formatUsd(signal.totalPositionValue, { compact: true })}
            />
            <Stat label="Traders" value={String(signal.traderCount)} />
          </div>
        </div>

        {/* Action buttons: Trade + Expand */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <a
            href={polymarketUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            title="Open on Polymarket"
            aria-label="Open on Polymarket"
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition"
          >
            Trade
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4.5 2h5.5v5.5M10 2L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <button
            type="button"
            aria-label={expanded ? "Collapse traders" : "Expand traders"}
            className="h-8 w-8 grid place-items-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Expanded trader list */}
      {expanded && (
        <div className="border-t border-neutral-200 bg-neutral-50/50">
          <div className="px-5 py-3 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            <div>Trader</div>
            <div className="text-right">Entry</div>
            <div className="text-right">Shares</div>
            <div className="text-right">Position</div>
          </div>
          <ul className="divide-y divide-neutral-200/70">
            {signal.traders.map((t) => (
              <li
                key={t.proxyWallet}
                className="px-5 py-3 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center"
              >
                <a
                  href={`https://polymarket.com/profile/${t.proxyWallet}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 min-w-0 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.profileImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.profileImage}
                      alt=""
                      className="h-7 w-7 rounded-full bg-neutral-200 object-cover flex-shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-neutral-200 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-900 truncate">
                      {t.userName}
                    </div>
                    <div className="text-[11px] text-neutral-500 tabular-nums">
                      rank #{t.rank}
                      {typeof t.pnl === "number" && t.pnl !== 0 && (
                        <>
                          {" · "}
                          <span
                            className={
                              t.pnl >= 0 ? "text-emerald-600" : "text-rose-600"
                            }
                          >
                            {t.pnl >= 0 ? "+" : ""}
                            {formatUsd(t.pnl, { compact: true })} PnL
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </a>
                <div className="text-sm tabular-nums text-neutral-600 text-right">
                  {formatProbability(t.avgPrice)}
                </div>
                <div className="text-sm tabular-nums text-neutral-600 text-right">
                  {formatShares(t.shares)}
                </div>
                <div className="text-sm tabular-nums font-semibold text-neutral-900 text-right">
                  {formatUsd(t.positionValue)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-neutral-500">{label}</span>
      <span
        className={`tabular-nums ${
          emphasize
            ? "text-base font-semibold text-neutral-900"
            : "text-sm font-medium text-neutral-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function pickOutcomeTone(outcome: string): string {
  const o = outcome.trim().toLowerCase();
  if (o === "yes") return "bg-emerald-100 text-emerald-800";
  if (o === "no") return "bg-rose-100 text-rose-800";
  // Sports / multi-outcome markets get a neutral-accented badge.
  return "bg-sky-100 text-sky-800";
}
