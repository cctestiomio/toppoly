# Polymarket Smart Money Signals

A Next.js site that surfaces markets where multiple top-ranked Polymarket traders are holding the same position — a "follow the smart money" screen.

It pulls the [monthly profit leaderboard](https://polymarket.com/leaderboard/overall/monthly/profit), fetches each trader's current open positions, groups them by market + outcome, keeps only clusters with 3+ traders on the same side, and sorts by average position size.

## Features

- **Light-mode, readable UI** — no dark mode, clean typography, expandable cards.
- **Signal cards** show the market, the outcome (Yes / No / team), live price, the list of top traders on that side, each trader's entry price, shares, and USD position size.
- **Adjustable filters** — minimum cluster size (2–5) and top-N traders sample (25 or 50).
- **Server-side caching** — underlying Polymarket fetches revalidate every 10 minutes; the UI re-renders on the next request.
- **JSON endpoint** at `/api/signals` for programmatic use.

## Data sources

All data comes from Polymarket's public, unauthenticated data-API:

- `GET https://data-api.polymarket.com/v1/leaderboard?timePeriod=MONTH&orderBy=PNL&limit=50`
- `GET https://data-api.polymarket.com/positions?user={wallet}&sortBy=CURRENT`

No API key required.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint (eslint)
npm run build       # production build
```

## Deploy — GitHub → Vercel

1. Create a new, empty repo on GitHub.
2. Extract this zip locally and push it up:
   ```bash
   cd polymarket-signals
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```
3. Go to [vercel.com/new](https://vercel.com/new), click **Import Project**, pick the repo.
4. Vercel auto-detects Next.js. Hit **Deploy** — no environment variables are needed.

The first build takes ~60 seconds. After that, page requests hit Vercel's edge cache for 10 minutes at a time.

## Tuning

Defaults live in `app/page.tsx` and `app/api/signals/route.ts`:

| Query param | Default | Range | Meaning |
|---|---|---|---|
| `min` | 3 | 2–10 | Min unique top-traders on one side before it's a signal |
| `top` | 50 | 10–50 | How many top monthly traders to sample (API caps at 50) |

Internal knobs in `lib/signals.ts`:

- `minPositionValue` (default `$50`) — drops dust positions.
- `concurrency` (default `6`) — parallel requests to the positions endpoint.

## Architecture

```
app/
  layout.tsx               Light-mode shell
  page.tsx                 Server component — calls buildSignals() directly
  api/signals/route.ts     JSON API version
  globals.css              Tailwind entry
components/
  SignalCard.tsx           Expandable trader list (client component)
lib/
  types.ts                 Strict Polymarket API + derived types
  polymarket.ts            Typed fetchers + bounded concurrency
  signals.ts               Aggregation + filter + sort
  format.ts                USD / probability / date formatters
```

## Disclaimer

This tool is informational only. Not financial advice. Polymarket data is provided as-is, and the fact that top traders hold a position does not guarantee it will be profitable. Always do your own research.
