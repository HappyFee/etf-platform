import type { BaseStrategyConfig, CompositeStrategyConfig, StrategyConfig } from "./types";

const defaultUniverse = [
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
];

export const defaultCashReplacementSymbol = "511880";
export const defaultBenchmarkSymbol = "510300";
export const universeEqualWeightBenchmark = "__universe_equal_weight__";

export const defaultStrategy: BaseStrategyConfig = {
  kind: "base",
  id: "balanced-etf-rotation",
  name: "均衡 ETF 因子轮动",
  description: "用动量、趋势、波动和流动性构建的周度 Top 3 ETF 轮动策略。",
  universe: defaultUniverse,
  factors: [
    {
      key: "momentum-60",
      id: "return",
      enabled: true,
      weight: 0.38,
      direction: "desc",
      params: { window: 60 }
    },
    {
      key: "trend-60",
      id: "close_ma_ratio",
      enabled: true,
      weight: 0.24,
      direction: "desc",
      params: { window: 60 }
    },
    {
      key: "volatility-20",
      id: "volatility",
      enabled: true,
      weight: 0.2,
      direction: "asc",
      params: { window: 20 }
    },
    {
      key: "drawdown-60",
      id: "max_drawdown",
      enabled: true,
      weight: 0.12,
      direction: "asc",
      params: { window: 60 }
    },
    {
      key: "liquidity-20",
      id: "amount_ma",
      enabled: true,
      weight: 0.06,
      direction: "desc",
      params: { window: 20 }
    }
  ],
  filters: [
    {
      factorId: "amount_ma",
      operator: ">=",
      value: 120_000_000,
      params: { window: 20 }
    }
  ],
  rebalance: {
    frequency: "weekly",
    weeklyDay: 1,
    monthlyDay: 1
  },
  portfolio: {
    topN: 3,
    weighting: "equal",
    fixedWeights: [0.4, 0.3, 0.3]
  },
  transactionCostBps: 6,
  benchmarkSymbol: defaultBenchmarkSymbol,
  risk: {
    cashReturnAnnual: 0.015,
    cashReplacementSymbol: defaultCashReplacementSymbol
  }
};

export const defensiveStrategy: BaseStrategyConfig = {
  ...defaultStrategy,
  id: "defensive-low-volatility",
  name: "低波动防守轮动",
  description: "更重视低波动、低回撤和流动性，适合作为组合策略的防守腿。",
  portfolio: {
    topN: 2,
    weighting: "score"
  },
  factors: [
    {
      key: "defensive-volatility-40",
      id: "volatility",
      enabled: true,
      weight: 0.36,
      direction: "asc",
      params: { window: 40 }
    },
    {
      key: "defensive-drawdown-90",
      id: "max_drawdown",
      enabled: true,
      weight: 0.28,
      direction: "asc",
      params: { window: 90 }
    },
    {
      key: "defensive-momentum-80",
      id: "return",
      enabled: true,
      weight: 0.24,
      direction: "desc",
      params: { window: 80 }
    },
    {
      key: "defensive-liquidity-20",
      id: "amount_ma",
      enabled: true,
      weight: 0.12,
      direction: "desc",
      params: { window: 20 }
    }
  ]
};

export const growthStrategy: BaseStrategyConfig = {
  ...defaultStrategy,
  id: "growth-momentum-rotation",
  name: "成长动量轮动",
  description: "提高短中期动量和趋势因子权重，更偏成长和进攻型配置。",
  portfolio: {
    topN: 3,
    weighting: "equal"
  },
  factors: [
    {
      key: "growth-momentum-40",
      id: "return",
      enabled: true,
      weight: 0.42,
      direction: "desc",
      params: { window: 40 }
    },
    {
      key: "growth-momentum-120",
      id: "return",
      enabled: true,
      weight: 0.2,
      direction: "desc",
      params: { window: 120 }
    },
    {
      key: "growth-trend-30",
      id: "close_ma_ratio",
      enabled: true,
      weight: 0.22,
      direction: "desc",
      params: { window: 30 }
    },
    {
      key: "growth-volatility-20",
      id: "volatility",
      enabled: true,
      weight: 0.16,
      direction: "asc",
      params: { window: 20 }
    }
  ]
};

export const defaultCompositeStrategy: CompositeStrategyConfig = {
  kind: "composite",
  id: "core-satellite-composite",
  name: "核心卫星组合",
  description: "将均衡轮动、防守轮动和成长轮动按权重组合成一个新策略。",
  components: [
    { strategyId: defaultStrategy.id, weight: 0.45 },
    { strategyId: defensiveStrategy.id, weight: 0.35 },
    { strategyId: growthStrategy.id, weight: 0.2 }
  ],
  transactionCostBps: 0,
  benchmarkSymbol: defaultBenchmarkSymbol,
  risk: {
    cashReturnAnnual: 0.015
  }
};

export const defaultStrategies: StrategyConfig[] = [
  defaultStrategy,
  defensiveStrategy,
  growthStrategy,
  defaultCompositeStrategy
];
