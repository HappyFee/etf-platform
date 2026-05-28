# A-Share ETF Factor Platform Design

## Goal

Build a deployable MVP for an A-share ETF factor strategy platform. The first version targets personal use and ordinary investors: users can choose ETF universes, combine built-in factors, configure rebalance and risk rules, run a backtest, and track the latest signal.

## Product Scope

The MVP is a static-friendly web application with an embedded TypeScript factor and backtest engine. It ships with demonstration A-share ETF data so the site works immediately, and it includes data-refresh extension points for future zvt, akshare, or Qlib-backed pipelines.

The platform has three user-facing modes:

- Overview: key metrics, current holdings, latest rebalance signal.
- Strategy Lab: editable factor weights, ETF universe, filters, rebalance frequency, portfolio sizing, and risk controls.
- Factor Library: built-in factor definitions inspired by Qlib expression features, Zipline factor/filter/classifier separation, and common TA-style indicators.

## Architecture

The web app uses Vite, React, TypeScript, Recharts, and lucide-react. Core financial logic lives in focused TypeScript modules under `src/core`, separate from React views under `src/components`. This keeps the calculation layer reusable by a future API worker or Taro mini-program.

The first deploy target is Vercel or Netlify as a static build. Scheduled data updates are expected to run outside the request path, for example through GitHub Actions, then write JSON data consumed by the static site. The MVP includes deterministic demo data and a documented adapter path instead of coupling the UI to a live data provider.

## Core Domain Model

`MarketBar` represents daily ETF OHLCV data. `EtfProfile` stores display metadata and category. `StrategyConfig` stores the user-configurable DSL: universe, factors, filters, rebalance policy, portfolio construction, transaction cost, and risk rules.

`FactorDefinition` describes a built-in factor. Factor outputs are cross-sectionally ranked on each rebalance date. Positive direction factors prefer higher values, negative direction factors prefer lower values. Filters remove ETFs before scoring.

`BacktestResult` contains an equity curve, metrics, rebalance events, current holdings, latest rankings, and warnings. These outputs drive the whole UI and can be serialized for tracking.

## Data Flow

1. Load ETF profiles and market bars.
2. Read the current strategy config.
3. Validate that selected ETFs and factors have enough history.
4. On each rebalance date, compute factor values, normalize ranks, apply factor weights, and select Top N ETFs.
5. Apply transaction costs and daily portfolio returns to the equity curve.
6. Derive metrics, latest holdings, latest factor rankings, and next rebalance date.

## Built-In Factors

The first factor catalog contains momentum, trend, volatility, drawdown, liquidity, and correlation-style building blocks. The UI exposes safe parameters and labels for ordinary investors, while the config remains structured enough for personal advanced use.

Initial factors:

- 20/60/120-day return
- Close versus 20/60/120-day moving average
- 20/60-day realized volatility
- 60/120-day maximum drawdown
- 20-day average amount
- Trend slope

## Error Handling

The engine returns warnings for insufficient data, empty universes, disabled factors, invalid Top N settings, or filters that remove every ETF. The UI keeps the previous valid configuration and shows non-blocking warnings instead of crashing.

## Testing

Core behavior is covered by Vitest:

- Factor values and rank direction
- Filter application
- Rebalance event generation
- Metrics such as max drawdown and total return
- Strategy validation and warning behavior

The UI is verified by production build and local browser smoke checks.

## Deployment

The app builds to static assets with `npm run build`. It can deploy directly to Vercel, Netlify, or Cloudflare Pages. Computation-heavy or live-data workflows should run as scheduled jobs and publish JSON artifacts, preserving free-tier friendliness.
