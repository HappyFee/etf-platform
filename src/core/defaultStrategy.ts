import type { StrategyConfig } from "./types";

export const defaultStrategy: StrategyConfig = {
  id: "balanced-etf-rotation",
  name: "均衡 ETF 因子轮动",
  description: "用动量、趋势、波动和流动性构建的周度 Top 3 ETF 轮动策略。",
  universe: [
    "510300",
    "510500",
    "512100",
    "159915",
    "512880",
    "512690",
    "512010",
    "515790",
    "518880",
    "511010",
    "159928",
    "159981"
  ],
  factors: [
    {
      id: "return_60d",
      enabled: true,
      weight: 0.38,
      direction: "desc",
      params: { window: 60 }
    },
    {
      id: "close_ma60_ratio",
      enabled: true,
      weight: 0.24,
      direction: "desc",
      params: { window: 60 }
    },
    {
      id: "volatility_20d",
      enabled: true,
      weight: 0.2,
      direction: "asc",
      params: { window: 20 }
    },
    {
      id: "max_drawdown_60d",
      enabled: true,
      weight: 0.12,
      direction: "asc",
      params: { window: 60 }
    },
    {
      id: "amount_ma20",
      enabled: true,
      weight: 0.06,
      direction: "desc",
      params: { window: 20 }
    }
  ],
  filters: [
    {
      factorId: "amount_ma20",
      operator: ">=",
      value: 120_000_000,
      params: { window: 20 }
    }
  ],
  rebalance: {
    frequency: "weekly"
  },
  portfolio: {
    topN: 3,
    weighting: "equal"
  },
  transactionCostBps: 6,
  risk: {
    cashReturnAnnual: 0.015
  }
};
