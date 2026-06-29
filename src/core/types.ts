export type FactorDirection = "asc" | "desc";

export type FactorCategory =
  | "momentum"
  | "trend"
  | "risk"
  | "liquidity"
  | "quality";

export type FilterOperator = ">" | ">=" | "<" | "<=" | "between";

export type RebalanceFrequency = "daily" | "weekly" | "monthly";

export type WeightingMethod = "equal" | "score" | "fixed";

export type ExecutionPrice = "next_open" | "next_close";

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
  key?: string;
  factorId: string;
  operator: FilterOperator;
  value: number;
  value2?: number;
  params?: FactorParams;
}

export interface RebalanceConfig {
  frequency: RebalanceFrequency;
  weeklyDay?: number;
  monthlyDay?: number;
}

export interface PortfolioConfig {
  topN: number;
  weighting: WeightingMethod;
  fixedWeights?: number[];
}

export interface RiskConfig {
  cashReturnAnnual: number;
  maxPositionWeight?: number;
  minCashWeight?: number;
  cashReplacementSymbol?: string;
}

export interface ExecutionConfig {
  price: ExecutionPrice;
  slippageBps: number;
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
  execution?: ExecutionConfig;
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
  execution?: ExecutionConfig;
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
  benchmarkEquity?: number;
  excessReturn?: number;
}

export interface RebalanceEvent {
  date: string;
  signalDate?: string;
  tradeDate?: string;
  holdings: Holding[];
  rankings: EvaluationRow[];
  turnover: number;
  costBps?: number;
  slippageBps?: number;
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
  benchmarkTotalReturn?: number;
  excessAnnualizedReturn?: number;
  informationRatio?: number;
}

export interface BenchmarkResult {
  name: string;
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
}

export interface DataQualitySymbol {
  symbol: string;
  name: string;
  startDate: string;
  latestDate: string;
  barCount: number;
  missingDays: number;
  coverageRatio: number;
  averageAmount: number;
  warnings: string[];
}

export interface DataQualityReport {
  latestDate: string;
  earliestDate: string;
  symbolCount: number;
  staleSymbols: string[];
  estimatedAmountSymbols: string[];
  symbols: DataQualitySymbol[];
  warnings: string[];
}

export interface RobustnessCase {
  name: string;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpe: number;
}

export interface RobustnessReport {
  cases: RobustnessCase[];
  summary: string;
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
  benchmark?: BenchmarkResult;
  latestSignal: LatestSignal;
  warnings: string[];
}
