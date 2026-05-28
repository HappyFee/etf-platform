# A-Share ETF Factor Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable MVP platform for configuring, backtesting, and tracking A-share ETF factor rotation strategies.

**Architecture:** Use a static-friendly Vite React app with a reusable TypeScript factor/backtest engine. Keep financial logic independent from React so it can later move into a worker, API service, or Taro mini-program package.

**Tech Stack:** Vite, React, TypeScript, Vitest, Recharts, lucide-react, GitHub Actions, optional Python data adapter notes for zvt/akshare.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`

- [ ] Define the Vite React TypeScript project with scripts for dev, build, preview, test, and lint.
- [ ] Add a shell app that renders the product navigation and a placeholder dashboard.
- [ ] Install dependencies and verify `npm test` can run.

### Task 2: Core Domain and Sample Data

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/date.ts`
- Create: `src/core/math.ts`
- Create: `src/core/sampleData.ts`
- Create: `src/core/sampleData.test.ts`

- [ ] Define market data, factor, strategy, and backtest output types.
- [ ] Add deterministic A-share ETF demonstration data covering several ETF categories.
- [ ] Add tests proving sample bars are sorted, non-empty, and contain every ETF profile.

### Task 3: Factor Engine

**Files:**
- Create: `src/core/factors.ts`
- Create: `src/core/factors.test.ts`

- [ ] Implement built-in factor definitions for momentum, trend, volatility, drawdown, liquidity, and slope.
- [ ] Implement factor scoring, rank normalization, filters, and warning generation.
- [ ] Add tests for direction handling, filter behavior, and weighted score calculation.

### Task 4: Strategy Backtest Engine

**Files:**
- Create: `src/core/backtest.ts`
- Create: `src/core/backtest.test.ts`
- Create: `src/core/defaultStrategy.ts`

- [ ] Implement rebalance scheduling, holdings selection, transaction-cost handling, and equity curve generation.
- [ ] Implement performance metrics and latest signal output.
- [ ] Add tests for weekly/monthly rebalances, drawdown, and empty-filter warnings.

### Task 5: Product UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Create: `src/components/Dashboard.tsx`
- Create: `src/components/StrategyLab.tsx`
- Create: `src/components/FactorLibrary.tsx`
- Create: `src/components/BacktestCharts.tsx`
- Create: `src/components/SignalPanel.tsx`
- Create: `src/components/ui.tsx`

- [ ] Build the main app shell with tabs for overview, strategy lab, factors, and signals.
- [ ] Build editable controls for universe, factors, filters, rebalance, Top N, and transaction cost.
- [ ] Render equity, drawdown, allocation, ranking, and signal views.
- [ ] Keep text compact and dashboard-oriented.

### Task 6: Data Refresh and Deployment

**Files:**
- Create: `scripts/fetch-akshare-etf.py`
- Create: `.github/workflows/refresh-data.yml`
- Create: `README.md`
- Create: `netlify.toml`
- Create: `vercel.json`

- [ ] Document how the platform reuses zvt/akshare/Qlib-style concepts without hard-coupling to them.
- [ ] Add an optional akshare data adapter script that writes normalized ETF bars.
- [ ] Add static deployment config for Vercel and Netlify.

### Task 7: Verification

**Files:**
- Existing files from prior tasks.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start the local dev server and verify the UI in a browser.
- [ ] Fix any test, build, or visual issues discovered during verification.
