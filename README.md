# A-share ETF Factor Platform

配置化 A 股 ETF 因子策略平台。第一版支持 ETF 池、因子权重、流动性过滤、调仓频率、持仓数量、交易成本、回测报告和最新信号跟踪。

## Stack

- Vite + React + TypeScript
- Vitest for core engine tests
- Recharts for backtest charts
- lucide-react for UI icons
- Static deploy target: Vercel, Netlify, Cloudflare Pages
- Optional data refresh: GitHub Actions + akshare

## Why This Shape

The platform borrows the useful parts of strong open-source quant projects without hard-coupling the product to a heavy runtime:

- Qlib-inspired factor expression and feature catalog thinking
- Zipline-inspired separation of Factor and Filter behavior
- TA-style indicator catalog naming
- zvt/akshare-friendly A-share ETF data adapter path

The calculation layer lives in `src/core`, separate from React views. That keeps it reusable for a future API service, scheduled worker, or Taro-based mini program.

## Local Development

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Verification

```bash
npm test
npm run build
```

## Data

The app ships deterministic demonstration data in `src/core/sampleData.ts`, so it runs immediately after install. At runtime it first tries to load `public/data/a-share-etf-bars.generated.json`; if that file is missing or invalid, it falls back to the bundled demo dataset.

To fetch real ETF daily bars with akshare:

```bash
python -m pip install akshare pandas
python scripts/fetch-akshare-etf.py --output public/data/a-share-etf-bars.generated.json
```

The included GitHub Actions workflow can refresh that generated JSON on trading days.

## Strategy DSL

The default strategy is defined in `src/core/defaultStrategy.ts`.

It contains:

- `universe`: selected ETF symbols
- `factors`: enabled factor ids, weights, direction, and params
- `filters`: pre-ranking filters such as 20-day average amount
- `rebalance`: daily, weekly, or monthly schedule
- `portfolio`: Top N and weighting method
- `transactionCostBps`: cost applied on turnover
- `risk`: cash return assumption when no ETF passes filters

## Deployment

Vercel:

```bash
npm run build
```

Use the included `vercel.json`; output directory is `dist`.

Netlify:

Use the included `netlify.toml`; publish directory is `dist`.

## Important Note

This project is research and tracking software, not investment advice. Validate data quality, ETF liquidity, fee assumptions, and live-trading constraints before using any signal.
