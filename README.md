# A-share ETF Factor Platform

[English](README.md) | [简体中文](README.zh-CN.md)

A lightweight, configurable A-share ETF factor strategy platform for research, backtesting, and signal tracking. It is designed for personal use and ordinary investors who want to turn strategy ideas into reusable configurations instead of editing code for every new idea.

The project can run as a static web app on GitHub Pages, Vercel, Netlify, or Cloudflare Pages. Its calculation layer is separated from the React UI so the same strategy core can later be reused by an API service, scheduled worker, or WeChat mini program.

## Features

- Configurable ETF universe with search by code, name, category, or tracked index
- Multiple user-defined base strategies
- Composite strategies that combine existing strategies by weight
- Parameterized factor instances, including momentum, trend, volatility, drawdown, and liquidity factors
- Add, duplicate, remove, enable, disable, and reweight factor instances from the UI
- Configurable pre-ranking filters, including threshold and range filters
- Daily, weekly, and monthly rebalance schedules with selected weekday or calendar day
- Equal-weight, score-weight, and fixed rank-based allocation
- Risk constraints such as maximum single-position weight and minimum cash weight
- Backtest diagnostics, benchmark comparison, data quality checks, and robustness stress tests
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

The app stores each account's strategy workspace separately in browser `localStorage`. Different accounts keep independent strategy lists and active strategy selections. The default account is a local account.

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
python -m pip install akshare pandas curl_cffi
python scripts/fetch-akshare-etf.py --output public/data/a-share-etf-bars.generated.json
```

The included GitHub Actions workflow can refresh the generated JSON on trading days.

## Strategy Configuration

Default strategies are defined in `src/core/defaultStrategy.ts`. The platform supports both base strategies and composite strategies.

A base strategy contains:

- `universe`: selected ETF symbols
- `factors`: enabled factor ids, weights, directions, and params
- `filters`: pre-ranking rules such as liquidity thresholds or volatility ranges
- `rebalance`: daily, weekly, or monthly schedule
- `portfolio`: Top N, weighting method, and optional fixed rank weights
- `transactionCostBps`: cost applied on turnover
- `execution`: price and slippage assumptions
- `risk`: cash return, maximum position weight, and minimum cash weight

A composite strategy contains:

- `components`: existing strategy ids and target weights
- `transactionCostBps`: optional wrapper-level cost assumption
- `execution`: wrapper execution assumptions
- `risk`: cash return assumption

Factors are parameterized. For example, the same `volatility` factor can be used with `window: 20`, `window: 50`, or any supported window without creating new hard-coded factor ids.

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
