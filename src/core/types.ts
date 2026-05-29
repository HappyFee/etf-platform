export type FactorDirection = "asc" | "desc";

export type FactorCategory =
  | "momentum"
  | "trend"
  | "risk"
  | "liquidity"
  | "quality";

export type FilterOperator = ">" | ">=" | "<" | "<=";

export type RebalanceFrequency = "daily" | "weekly" | "monthly";

export type WeightingMethod = "equal" | "score";

export interface MarketBar {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

export interface EtfProfile {
  symbol: string;
  name: string;
  exchange: "SH" | "SZ";
  category: string;
  trackingIndex: string;
  expenseRatio: number;
}

export type FactorParams = Record<string, number | string | boolean>;

export interface FactorSelection {
  key?: string;
  id: string;
  enabled: boolean;
  weight: number;
  direction: FactorDirection;
  params?: FactorParams;
}

export interface FilterRule {
  factorId: string;
  operator: FilterOperator;
  value: number;
  params?: FactorParams;
}

export interface RebalanceConfig {
  frequency: RebalanceFrequency;
}

export interface PortfolioConfig {
  topN: number;
  weighting: WeightingMethod;
}

export interface RiskConfig {
  cashReturnAnnual: number;
}

export interface BaseStrategyConfig {
  kind: "base";
  id: string;
  name: string;
  description: string;
  universe: string[];
  factors: FactorSelection[];
  filters: FilterRule[];
  rebalance: RebalanceConfig;
  portfolio: PortfolioConfig;
  transactionCostBps: number;
  risk: RiskConfig;
}

export interface StrategyComponent {
  strategyId: string;
  weight: number;
}

export interface CompositeStrategyConfig {
  kind: "composite";
  id: string;
  name: string;
  description: string;
  components: StrategyComponent[];
  transactionCostBps: number;
  risk: RiskConfig;
}

export type StrategyConfig = BaseStrategyConfig | CompositeStrategyConfig;

export interface FactorContext {
  bars: MarketBar[];
  index: number;
  params: FactorParams;
}

export interface FactorDefinition {
  id: string;
  name: string;
  category: FactorCategory;
  description: string;
  defaultDirection: FactorDirection;
  defaultParams: FactorParams;
  paramSchema?: Array<{
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
  }>;
  compute: (context: FactorContext) => number | null;
}

export interface FactorScoreDetail {
  raw: number | null;
  normalized: number;
  direction: FactorDirection;
  weight: number;
}

export interface EvaluationRow {
  symbol: string;
  name: string;
  category: string;
  score: number;
  passesFilters: boolean;
  factorScores: Record<string, FactorScoreDetail>;
  filterValues: Record<string, number | null>;
}

export interface EvaluationResult {
  date: string;
  rows: EvaluationRow[];
  warnings: string[];
}

export interface Holding {
  symbol: string;
  name: string;
  weight: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  dailyReturn: number;
  drawdown: number;
}

export interface RebalanceEvent {
  date: string;
  holdings: Holding[];
  rankings: EvaluationRow[];
  turnover: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  maxDrawdown: number;
  sharpe: number;
  calmar: number;
  winRate: number;
  rebalanceCount: number;
  averageTurnover: number;
}

export interface LatestSignal {
  date: string;
  holdings: Holding[];
  rankings: EvaluationRow[];
  nextRebalanceHint: string;
}

export interface BacktestResult {
  equityCurve: EquityPoint[];
  rebalances: RebalanceEvent[];
  metrics: BacktestMetrics;
  latestSignal: LatestSignal;
  warnings: string[];
}
