# A-share ETF Factor Platform

[English](README.md) | [简体中文](README.zh-CN.md)

A lightweight, configurable A-share ETF factor strategy platform for research, backtesting, and signal tracking. It is designed for personal use and ordinary investors who want to turn strategy ideas into reusable configurations instead of editing code for every new idea.

The project can run as a static web app on GitHub Pages, Vercel, Netlify, or Cloudflare Pages. Its calculation layer is separated from the React UI so the same strategy core can later be reused by an API service, scheduled worker, or WeChat mini program.

## Features

- Fixed ETF universes plus monthly dynamic selection by history, data coverage, recent median turnover, and category caps
- Same-exposure deduplication and retention buffers to reduce unnecessary switching between similar ETFs
- Multiple user-defined base strategies
- Composite strategies that combine existing strategies by weight
- Parameterized factor instances, including momentum, trend, volatility, drawdown, and liquidity factors
- Add, duplicate, remove, enable, disable, and reweight factor instances from the UI
- Configurable pre-ranking filters, including threshold and range filters
- Daily, weekly, and monthly rebalance schedules with selected weekday or calendar day
- Trading-day interval schedules and optional return-ranked rotation (20 trading days by default)
- Independent buy rank/return ranges and new-position limits; sell rank/return conditions with any/all matching
- Equal-weight, score-weight, and fixed rank-based allocation
- Risk constraints such as maximum single-position weight, minimum cash weight, and an optional idle-cash replacement ETF
- Saved backtest date ranges and selectable ETF or universe-equal-weight benchmarks
- T+1 open/close execution with slippage, minimum commission, volume participation, and price-limit constraints
- 70/30 out-of-sample validation, history-truncated signal replay, benchmark comparison, data quality checks, and robustness stress tests
- Account-scoped backtest snapshots, side-by-side metric comparison, and JSON/CSV export
- Latest signal tracking for follow-up decisions

## Stack

- Vite + React + TypeScript
- Vitest for core engine tests
- Recharts for backtest charts
- lucide-react for UI icons
- Static deployment targets: GitHub Pages, Vercel, Netlify, Cloudflare Pages
- Optional data refresh: GitHub Actions + AkShare with fallback providers

## Design Notes

The platform borrows useful patterns from mature open-source quant projects without depending on a heavy runtime:

- Qlib-inspired configuration-driven research workflow and factor catalog thinking
- zvt-inspired separation between factor scoring, filtering, and trading decisions
- Freqtrade-inspired parameter and protection configuration ideas
- vectorbt-inspired direction for future parameter sweeps and strategy comparison

The calculation layer lives in `src/core`, while React views live in `src/components`. This keeps strategy logic reusable beyond the current web UI.

## Local Development

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Accounts And WeChat Login

The app stores each account's strategy workspace separately in browser `localStorage`. Different accounts keep independent strategy lists, active strategy selections, and backtest snapshots. The default account is a local account.

When Supabase is configured, users can sign in by email magic link and sync strategies and backtest snapshots to the cloud. Snapshots reuse the existing `strategies` JSONB column, so no new table or SQL migration is required. The account disclosure shows whether changes are saving, saved, or failed; rapid edits are grouped before the cloud write.

WeChat login has two modes:

- Without WeChat environment variables, the UI uses local mock WeChat accounts for personal offline use and development.
- With `VITE_WECHAT_APP_ID`, the UI redirects to the WeChat Open Platform website QR authorization flow.

Real WeChat login must keep `AppSecret` on the server. This project includes a Vercel Serverless Function:

```text
/api/auth/wechat
```

For Vercel deployments, configure:

```bash
VITE_WECHAT_APP_ID=wx_xxx
VITE_WECHAT_REDIRECT_URI=https://your-domain.example/
WECHAT_APP_ID=wx_xxx
WECHAT_APP_SECRET=your_wechat_app_secret
```

The frontend posts the callback `{ code, state }` to `/api/auth/wechat` by default. The serverless function exchanges the code for `access_token` and user profile data, then returns:

```json
{
  "id": "wechat-openid-or-unionid",
  "provider": "wechat",
  "displayName": "User nickname",
  "avatarUrl": "https://example.com/avatar.png"
}
```

Pure static platforms such as GitHub Pages cannot run the serverless API, so real WeChat login is unavailable there. Use Vercel or another host with a backend function.

## Verification

```bash
npm test
npm run build
```

## Data

The app ships deterministic demonstration data in `src/core/sampleData.ts`, so it runs immediately after install.

At runtime it first tries to load:

```text
public/data/a-share-etf-bars.generated.json
```

If that file is missing or invalid, the app falls back to the bundled demo dataset.

To fetch real ETF daily bars:

```bash
python -m pip install -r scripts/requirements-data.txt
python scripts/fetch-akshare-etf.py --discover --discover-limit 60 --full-refresh
```

`--discover` builds a broad mother pool from the current AkShare ETF market snapshot. It keeps the default symbols and prior members that remain inside a liquidity buffer, then records every membership change in `universeSnapshots`. Backtests select from the membership known at each date. The included GitHub Actions workflow uses `--full-refresh` on trading days so forward-adjusted prices cannot mix adjustment bases; a failed symbol keeps its previous history.

The refresh runs twice on weekdays (18:37 and 20:37 Asia/Shanghai; GitHub may delay scheduled jobs). If discovery is unavailable, it refreshes the last valid mother pool instead. Publication requires at least 80% of requested symbols to reach the latest completed XSHG trading session, allowing for weekends and holidays. Stale or truncated responses are rejected and failed runs leave the previous data file unchanged. Fallback providers must support the requested price adjustment; raw prices are never silently substituted for adjusted prices.

Use `--report refresh-report.json` for machine-readable diagnostics. Every scheduled run preserves this report as the `etf-refresh-diagnostics` artifact and writes a job summary, including failures. Enable GitHub Actions failure notifications in your GitHub notification settings and inspect failed runs under **Actions > Refresh ETF data**. The app warns after the next trading day's 21:00 update deadline; older data files without calendar metadata retain the seven-day fallback warning. Update the pinned trading-calendar dependency when future exchange holiday schedules become available.

On Windows, stop local Vite servers before refreshing if file replacement reports `WinError 5`; the failed write preserves the previous file. Restart the server after the refresh.

Real membership history starts accumulating on the first discovery run. Earlier periods are reconstructed from symbols visible in the data file and produce an explicit survivorship-bias warning.

## Strategy Configuration

Default strategies are defined in `src/core/defaultStrategy.ts`. The platform supports both base strategies and composite strategies.

A base strategy contains:

- `universe`: selected ETF symbols
- `universeSelection`: fixed or dynamic mode plus history, coverage, turnover, total cap, category cap, and replacement-buffer settings
- `factors`: enabled factor ids, weights, directions, and params
- `filters`: pre-ranking rules such as liquidity thresholds or volatility ranges
- `rebalance`: daily, weekly, or monthly schedule
- `portfolio`: Top N, weighting method, and optional fixed rank weights
- `portfolio.investedWeight`: target strategy allocation from 0 to 1; the remainder uses the replacement asset or cash
- `rotationRules`: optional return lookback, buy conditions, and sell conditions; replaces factor scoring with descending period returns while preserving pre-ranking filters
- `transactionCostBps`: one-way cost applied to actual traded notional
- `benchmarkSymbol`: selected ETF benchmark, or the universe-equal-weight option
- `backtestStartDate` / `backtestEndDate`: optional saved evaluation window
- `execution`: T+1 execution point, slippage, initial capital, minimum commission, volume participation, and price-limit threshold
- `risk`: cash return, maximum position weight, minimum cash weight, and idle-cash replacement

A composite strategy contains:

- `components`: existing strategy ids and target weights
- `transactionCostBps`: optional wrapper-level cost assumption
- `benchmarkSymbol`: composite-level comparison benchmark
- `backtestStartDate` / `backtestEndDate`: optional composite evaluation window
- `execution`: wrapper execution assumptions
- `risk`: cash return assumption

Factors are parameterized. For example, the same `volatility` factor can be used with `window: 20`, `window: 50`, or any supported window without creating new hard-coded factor ids.

Buy ranges are inclusive; sell conditions use strict rank/return comparisons and ignore blank conditions. Incumbents can stay outside the buy range until a sell condition fires. New-buy quantity counts ETF symbols, not shares. The strategy position cap excludes the idle-cash replacement asset. Ineligible or missing-data positions are targeted for exit at the next rotation, subject to actual execution constraints; symbols sold in that cycle cannot immediately reenter. Conditions are evaluated at the signal close and executed through the existing T+1 model. Trading-day intervals are anchored to the actual backtest start.

Sell conditions veto conflicting buys, including new entries. Retained positions do not consume the new-buy allowance. Orders are net target-minus-current weight changes, with no commission for unchanged weights. Return comparisons tolerate floating-point error of `1e-10`. The replacement asset is excluded from rotation ranks; tied returns use symbol order, and rank weights remain positive. Failed or partial sells keep occupying actual position slots and allocation budgets. Missing execution quotes, stopped close-session volume, and invalid constrained turnover cannot generate fictional fills. Open orders use preceding-day turnover only. Weights drift with prices between actual rebalances, and off-cycle signals retain the actual portfolio. Invalid rule parameters produce explicit errors and no orders. These corrections can change new backtest results; saved snapshots remain unchanged. Execution still models continuous weights rather than broker round lots or an order book.

## Deployment

GitHub Pages production deployment:

```bash
npm test
$env:VITE_BASE_PATH="/etf-platform/"
npm run build
```

The repository includes `.github/workflows/deploy-pages.yml`. Every push to `master` builds with `VITE_BASE_PATH=/etf-platform/` and deploys `dist` to GitHub Pages.

Production URL:

```text
https://happyfee.github.io/etf-platform/
```

If the first deployment is blocked by repository settings, open GitHub repository Settings -> Pages and set Source to GitHub Actions.

Vercel:

```bash
npm run build
```

Use the included `vercel.json`; output directory is `dist`.

Netlify:

Use the included `netlify.toml`; publish directory is `dist`.

## Important Note

This project is research and tracking software, not investment advice. Validate data quality, ETF liquidity, fee assumptions, and live-trading constraints before using any signal.
