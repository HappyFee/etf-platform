import { nextRebalanceHint, shouldRebalance } from "./date";
import { defaultBenchmarkSymbol, universeEqualWeightBenchmark } from "./defaultStrategy";
import { evaluateUniverse } from "./factors";
import { maxDrawdown, mean, rollingReturns, safeDivide, standardDeviation } from "./math";
import { groupBarsBySymbol } from "./sampleData";
import type {
  BaseStrategyConfig,
  BenchmarkResult,
  BacktestMetrics,
  BacktestResult,
  CompositeStrategyConfig,
  EquityPoint,
  EtfProfile,
  EvaluationRow,
  ExecutionConfig,
  Holding,
  MarketBar,
  RebalanceEvent,
  StrategyConfig
} from "./types";

interface RunBacktestInput {
  bars: MarketBar[];
  profiles: EtfProfile[];
  config: StrategyConfig;
  strategyBook?: StrategyConfig[];
}

interface DailyPortfolioReturn {
  dailyReturn: number;
  warnings: string[];
}

interface ResolvedExecutionConfig {
  price: ExecutionConfig["price"];
  slippageBps: number;
  initialCapital: number;
  minimumCommission: number;
  maxParticipationRate: number;
  priceLimitThreshold: number;
}

interface MarketLookup {
  getBar: (symbol: string, date: string) => MarketBar | null;
}

interface RebalanceExecution {
  holdings: Holding[];
  turnover: number;
  tradedWeight: number;
  costRate: number;
  commissionAmount: number;
  fillRate: number;
  constraintCount: number;
  warnings: string[];
}

interface PendingRebalance {
  signalDate: string;
  tradeDate: string;
  holdings: Holding[];
  rankings: EvaluationRow[];
}

interface BenchmarkBuildResult {
  benchmark: BenchmarkResult;
  warning?: string;
}

interface BacktestRange {
  dates: string[];
  startIndex: number;
  warnings: string[];
}

export interface CloseLookup {
  getClose: (symbol: string, date: string) => number | null;
}

function uniqueSortedDates(bars: MarketBar[]): string[] {
  return [...new Set(bars.map((bar) => bar.date))].sort();
}

export function createCloseLookup(bars: MarketBar[]): CloseLookup {
  const closesBySymbol = new Map<string, Map<string, number>>();

  for (const bar of bars) {
    const closesByDate = closesBySymbol.get(bar.symbol) ?? new Map<string, number>();
    closesByDate.set(bar.date, bar.close);
    closesBySymbol.set(bar.symbol, closesByDate);
  }

  return {
    getClose(symbol: string, date: string): number | null {
      return closesBySymbol.get(symbol)?.get(date) ?? null;
    }
  };
}

function createMarketLookup(bars: MarketBar[]): MarketLookup {
  const barsBySymbol = new Map<string, Map<string, MarketBar>>();

  for (const bar of bars) {
    const barsByDate = barsBySymbol.get(bar.symbol) ?? new Map<string, MarketBar>();
    barsByDate.set(bar.date, bar);
    barsBySymbol.set(bar.symbol, barsByDate);
  }

  return {
    getBar(symbol: string, date: string): MarketBar | null {
      return barsBySymbol.get(symbol)?.get(date) ?? null;
    }
  };
}

function defaultExecution(config: StrategyConfig): ResolvedExecutionConfig {
  return {
    price: config.execution?.price ?? "next_close",
    slippageBps: Math.max(0, config.execution?.slippageBps ?? 3),
    initialCapital: Math.max(1, config.execution?.initialCapital ?? 100_000),
    minimumCommission: Math.max(
      0,
      config.execution?.minimumCommission ?? (config.kind === "composite" ? 0 : 5)
    ),
    maxParticipationRate: Math.min(
      1,
      Math.max(0, config.execution?.maxParticipationRate ?? 0.1)
    ),
    priceLimitThreshold: Math.min(
      1,
      Math.max(0, config.execution?.priceLimitThreshold ?? 0.1)
    )
  };
}

function portfolioPeriodReturn(
  marketLookup: MarketLookup,
  startDate: string,
  startField: "open" | "close",
  endDate: string,
  endField: "open" | "close",
  holdings: Holding[],
  cashReturnAnnual: number,
  dayFraction = 1
): DailyPortfolioReturn {
  const cashPeriodReturn = (cashReturnAnnual / 252) * dayFraction;

  if (holdings.length === 0) {
    return { dailyReturn: cashPeriodReturn, warnings: [] };
  }

  const warnings: string[] = [];
  const investedWeight = holdings.reduce((total, holding) => total + holding.weight, 0);
  const cashWeight = Math.max(0, 1 - investedWeight);
  const dailyReturn = holdings.reduce((total, holding) => {
    const startBar = marketLookup.getBar(holding.symbol, startDate);
    const endBar = marketLookup.getBar(holding.symbol, endDate);
    const startPrice = startBar?.[startField];
    const endPrice = endBar?.[endField];
    if (!startPrice || !endPrice) {
      warnings.push(
        `${endDate} ${holding.symbol} 缺少行情，按现金收益处理。`
      );
      return total + holding.weight * cashPeriodReturn;
    }
    return total + holding.weight * (endPrice / startPrice - 1);
  }, cashWeight * cashPeriodReturn);

  return { dailyReturn, warnings };
}

function dailyPortfolioReturn(
  closeLookup: CloseLookup,
  previousDate: string,
  currentDate: string,
  holdings: Holding[],
  cashReturnAnnual: number
): DailyPortfolioReturn {
  const cashDailyReturn = cashReturnAnnual / 252;
  const investedWeight = holdings.reduce((total, holding) => total + holding.weight, 0);
  const cashWeight = Math.max(0, 1 - investedWeight);
  const dailyReturn = holdings.reduce((total, holding) => {
    const previous = closeLookup.getClose(holding.symbol, previousDate);
    const current = closeLookup.getClose(holding.symbol, currentDate);
    if (!previous || !current) {
      return total + holding.weight * cashDailyReturn;
    }
    return total + holding.weight * (current / previous - 1);
  }, cashWeight * cashDailyReturn);

  return { dailyReturn, warnings: [] };
}

function isCompositeStrategy(config: StrategyConfig): config is CompositeStrategyConfig {
  return config.kind === "composite";
}

function isBaseStrategy(config: StrategyConfig): config is BaseStrategyConfig {
  return config.kind !== "composite";
}

function holdingsFromRows(
  rows: EvaluationRow[],
  config: BaseStrategyConfig,
  profiles: EtfProfile[]
): Holding[] {
  const selected = rows.slice(0, Math.max(0, config.portfolio.topN));
  const profileBySymbol = new Map(profiles.map((profile) => [profile.symbol, profile]));
  if (selected.length === 0) {
    return applyCashReplacement([], config, profileBySymbol);
  }

  let holdings: Holding[];

  if (config.portfolio.weighting === "fixed") {
    const configuredWeights = config.portfolio.fixedWeights ?? [];
    const rawWeights = selected.map((_, index) => Math.max(0, configuredWeights[index] ?? 0));
    const totalWeight = rawWeights.reduce((total, weight) => total + weight, 0);

    if (totalWeight > 0) {
      holdings = selected.map((row, index) => ({
        symbol: row.symbol,
        name: row.name,
        weight: rawWeights[index] / totalWeight
      }));
      return applyCashReplacement(applyRiskConstraints(holdings, config), config, profileBySymbol);
    }
  }

  if (config.portfolio.weighting === "score") {
    const scoreTotal = selected.reduce((total, row) => total + Math.max(0, row.score), 0);
    if (scoreTotal > 0) {
      holdings = selected.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        weight: Math.max(0, row.score) / scoreTotal
      }));
      return applyCashReplacement(applyRiskConstraints(holdings, config), config, profileBySymbol);
    }
  }

  holdings = selected.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    weight: 1 / selected.length
  }));
  return applyCashReplacement(applyRiskConstraints(holdings, config), config, profileBySymbol);
}

function applyCashReplacement(
  holdings: Holding[],
  config: BaseStrategyConfig,
  profileBySymbol: Map<string, EtfProfile>
): Holding[] {
  const replacementSymbol = config.risk.cashReplacementSymbol?.trim();
  if (!replacementSymbol) {
    return holdings;
  }

  const investedWeight = holdings.reduce((total, holding) => total + holding.weight, 0);
  const idleWeight = Math.max(0, 1 - investedWeight);
  if (idleWeight <= 0.0001) {
    return holdings;
  }

  const existing = holdings.find((holding) => holding.symbol === replacementSymbol);
  if (existing) {
    return holdings.map((holding) =>
      holding.symbol === replacementSymbol
        ? { ...holding, weight: holding.weight + idleWeight }
        : holding
    );
  }

  return [
    ...holdings,
    {
      symbol: replacementSymbol,
      name: profileBySymbol.get(replacementSymbol)?.name ?? replacementSymbol,
      weight: idleWeight
    }
  ];
}

function applyRiskConstraints(
  holdings: Holding[],
  config: BaseStrategyConfig
): Holding[] {
  if (holdings.length === 0) {
    return holdings;
  }

  const minCashWeight = Math.min(1, Math.max(0, config.risk.minCashWeight ?? 0));
  const targetInvestedWeight = Math.max(0, 1 - minCashWeight);
  const maxPositionWeight = Math.min(
    targetInvestedWeight,
    Math.max(0, config.risk.maxPositionWeight ?? targetInvestedWeight)
  );

  if (targetInvestedWeight <= 0 || maxPositionWeight <= 0) {
    return [];
  }

  let next = normalizeHoldings(holdings).map((holding) => ({
    ...holding,
    weight: holding.weight * targetInvestedWeight
  }));

  for (let iteration = 0; iteration < next.length; iteration += 1) {
    const overweight = next.filter((holding) => holding.weight > maxPositionWeight);
    if (overweight.length === 0) {
      break;
    }

    const excess = overweight.reduce(
      (total, holding) => total + holding.weight - maxPositionWeight,
      0
    );
    next = next.map((holding) =>
      holding.weight > maxPositionWeight
        ? { ...holding, weight: maxPositionWeight }
        : holding
    );

    const receivers = next.filter((holding) => holding.weight < maxPositionWeight);
    const receiverTotal = receivers.reduce((total, holding) => total + holding.weight, 0);
    if (receivers.length === 0 || receiverTotal <= 0) {
      break;
    }

    next = next.map((holding) => {
      if (holding.weight >= maxPositionWeight) {
        return holding;
      }
      const addWeight = excess * (holding.weight / receiverTotal);
      return {
        ...holding,
        weight: Math.min(maxPositionWeight, holding.weight + addWeight)
      };
    });
  }

  return next.filter((holding) => holding.weight > 0.0001);
}

function normalizeHoldings(holdings: Holding[]): Holding[] {
  const totalWeight = holdings.reduce((total, holding) => total + Math.max(0, holding.weight), 0);
  if (totalWeight <= 0) {
    return holdings.map((holding) => ({ ...holding, weight: 1 / holdings.length }));
  }
  return holdings.map((holding) => ({
    ...holding,
    weight: Math.max(0, holding.weight) / totalWeight
  }));
}

function tradeBlockedByPriceLimit(
  marketLookup: MarketLookup,
  symbol: string,
  previousDate: string,
  tradeDate: string,
  direction: 1 | -1,
  execution: ResolvedExecutionConfig
): boolean {
  if (execution.priceLimitThreshold <= 0) {
    return false;
  }

  const previousBar = marketLookup.getBar(symbol, previousDate);
  const tradeBar = marketLookup.getBar(symbol, tradeDate);
  const tradePrice = execution.price === "next_open" ? tradeBar?.open : tradeBar?.close;
  if (!previousBar?.close || !tradePrice || !tradeBar) {
    return false;
  }

  const move = tradePrice / previousBar.close - 1;
  const threshold = execution.priceLimitThreshold * 0.995;
  const reachesDirectionalLimit = direction > 0 ? move >= threshold : move <= -threshold;
  if (!reachesDirectionalLimit) {
    return false;
  }

  if (execution.price === "next_open") {
    return true;
  }

  const range = Math.abs(tradeBar.high - tradeBar.low) / Math.max(0.0001, tradePrice);
  return range < 0.0005;
}

function orderCapacityWeight(
  marketLookup: MarketLookup,
  symbol: string,
  previousDate: string,
  tradeDate: string,
  portfolioValue: number,
  execution: ResolvedExecutionConfig
): number {
  if (execution.maxParticipationRate <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const liquidityDate = execution.price === "next_open" ? previousDate : tradeDate;
  const amount = marketLookup.getBar(symbol, liquidityDate)?.amount;
  if (!amount || amount <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return (amount * execution.maxParticipationRate) / Math.max(1, portfolioValue);
}

function executeRebalance({
  previous,
  target,
  marketLookup,
  previousDate,
  tradeDate,
  portfolioValue,
  transactionCostBps,
  execution
}: {
  previous: Holding[];
  target: Holding[];
  marketLookup: MarketLookup;
  previousDate: string;
  tradeDate: string;
  portfolioValue: number;
  transactionCostBps: number;
  execution: ResolvedExecutionConfig;
}): RebalanceExecution {
  const epsilon = 0.0001;
  const previousMap = new Map(previous.map((holding) => [holding.symbol, holding]));
  const targetMap = new Map(target.map((holding) => [holding.symbol, holding]));
  const nextMap = new Map(
    previous.map((holding) => [holding.symbol, { ...holding }])
  );
  const symbols = new Set([...previousMap.keys(), ...targetMap.keys()]);
  const requestedTradedWeight = [...symbols].reduce((total, symbol) => {
    const previousWeight = previousMap.get(symbol)?.weight ?? 0;
    const targetWeight = targetMap.get(symbol)?.weight ?? 0;
    return total + Math.abs(targetWeight - previousWeight);
  }, 0);
  let priceLimitBlocks = 0;
  let volumeLimits = 0;
  let cashLimits = 0;

  for (const symbol of symbols) {
    const current = nextMap.get(symbol);
    const previousWeight = current?.weight ?? 0;
    const targetWeight = targetMap.get(symbol)?.weight ?? 0;
    if (targetWeight >= previousWeight - epsilon) {
      continue;
    }

    const requested = previousWeight - targetWeight;
    if (
      tradeBlockedByPriceLimit(
        marketLookup,
        symbol,
        previousDate,
        tradeDate,
        -1,
        execution
      )
    ) {
      priceLimitBlocks += 1;
      continue;
    }

    const capacity = orderCapacityWeight(
      marketLookup,
      symbol,
      previousDate,
      tradeDate,
      portfolioValue,
      execution
    );
    const filled = Math.min(requested, capacity);
    if (filled < requested - epsilon) {
      volumeLimits += 1;
    }
    if (current) {
      nextMap.set(symbol, { ...current, weight: previousWeight - filled });
    }
  }

  let availableCash = Math.max(
    0,
    1 - [...nextMap.values()].reduce((total, holding) => total + holding.weight, 0)
  );

  for (const symbol of symbols) {
    const previousWeight = previousMap.get(symbol)?.weight ?? 0;
    const targetHolding = targetMap.get(symbol);
    const targetWeight = targetHolding?.weight ?? 0;
    if (!targetHolding || targetWeight <= previousWeight + epsilon) {
      continue;
    }

    const requested = targetWeight - previousWeight;
    if (
      tradeBlockedByPriceLimit(
        marketLookup,
        symbol,
        previousDate,
        tradeDate,
        1,
        execution
      )
    ) {
      priceLimitBlocks += 1;
      continue;
    }

    const capacity = orderCapacityWeight(
      marketLookup,
      symbol,
      previousDate,
      tradeDate,
      portfolioValue,
      execution
    );
    const liquidityFilled = Math.min(requested, capacity);
    if (liquidityFilled < requested - epsilon) {
      volumeLimits += 1;
    }
    const filled = Math.min(liquidityFilled, availableCash);
    if (filled < liquidityFilled - epsilon) {
      cashLimits += 1;
    }
    if (filled <= epsilon) {
      continue;
    }

    const current = nextMap.get(symbol) ?? { ...targetHolding, weight: 0 };
    nextMap.set(symbol, { ...current, weight: current.weight + filled });
    availableCash = Math.max(0, availableCash - filled);
  }

  const holdings = [...nextMap.values()]
    .filter((holding) => holding.weight > epsilon)
    .sort((left, right) => right.weight - left.weight);
  const tradedWeight = [...symbols].reduce((total, symbol) => {
    const previousWeight = previousMap.get(symbol)?.weight ?? 0;
    const nextWeight = holdings.find((holding) => holding.symbol === symbol)?.weight ?? 0;
    return total + Math.abs(nextWeight - previousWeight);
  }, 0);
  const normalizedPortfolioValue = Math.max(1, portfolioValue);
  const commissionAmount = [...symbols].reduce((total, symbol) => {
    const previousWeight = previousMap.get(symbol)?.weight ?? 0;
    const nextWeight = holdings.find((holding) => holding.symbol === symbol)?.weight ?? 0;
    const orderWeight = Math.abs(nextWeight - previousWeight);
    if (orderWeight <= epsilon) {
      return total;
    }
    const notional = orderWeight * normalizedPortfolioValue;
    return (
      total +
      Math.max(
        (notional * Math.max(0, transactionCostBps)) / 10_000,
        execution.minimumCommission
      )
    );
  }, 0);
  const slippageAmount =
    (normalizedPortfolioValue * tradedWeight * execution.slippageBps) / 10_000;
  const warnings: string[] = [];

  if (priceLimitBlocks > 0) {
    warnings.push(`${tradeDate} 有 ${priceLimitBlocks} 笔交易触发涨跌停约束，未成交。`);
  }
  if (volumeLimits > 0) {
    warnings.push(`${tradeDate} 有 ${volumeLimits} 笔交易受成交额参与率限制，仅部分成交。`);
  }
  if (cashLimits > 0) {
    warnings.push(`${tradeDate} 有 ${cashLimits} 笔买入因可用现金不足，仅部分成交。`);
  }

  return {
    holdings,
    turnover: tradedWeight / 2,
    tradedWeight,
    costRate: Math.min(0.99, (commissionAmount + slippageAmount) / normalizedPortfolioValue),
    commissionAmount,
    fillRate:
      requestedTradedWeight <= epsilon
        ? 1
        : Math.min(1, tradedWeight / requestedTradedWeight),
    constraintCount: priceLimitBlocks + volumeLimits + cashLimits,
    warnings
  };
}

function drawdownAt(equity: number, peak: number): number {
  return peak === 0 ? 0 : Math.max(0, (peak - equity) / peak);
}

function calculateMetrics(
  curve: EquityPoint[],
  rebalances: RebalanceEvent[],
  benchmarkCurve?: EquityPoint[]
): BacktestMetrics {
  if (curve.length === 0) {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      maxDrawdown: 0,
      sharpe: 0,
      calmar: 0,
      winRate: 0,
      rebalanceCount: 0,
      averageTurnover: 0
    };
  }

  const finalEquity = curve.at(-1)!.equity;
  const totalReturn = finalEquity - 1;
  const years = Math.max(1 / 252, curve.length / 252);
  const annualizedReturn = finalEquity > 0 ? finalEquity ** (1 / years) - 1 : -1;
  const returns = curve.map((point) => point.dailyReturn).slice(1);
  const annualizedVolatility = standardDeviation(returns) * Math.sqrt(252);
  const maxCurveDrawdown = maxDrawdown(curve.map((point) => point.equity));
  const positiveDays = returns.filter((value) => value > 0).length;
  const activeDays = returns.filter((value) => value !== 0).length;
  const averageTurnover = mean(rebalances.map((event) => event.turnover));
  const benchmarkFinalEquity = benchmarkCurve?.at(-1)?.equity;
  const benchmarkTotalReturn =
    benchmarkFinalEquity === undefined ? undefined : benchmarkFinalEquity - 1;
  const excessReturns =
    benchmarkCurve && benchmarkCurve.length > 1
      ? curve
          .slice(1)
          .map((point, index) => point.dailyReturn - (benchmarkCurve[index + 1]?.dailyReturn ?? 0))
      : [];
  const benchmarkAnnualizedReturn =
    benchmarkFinalEquity === undefined
      ? undefined
      : benchmarkFinalEquity > 0
        ? benchmarkFinalEquity ** (1 / years) - 1
        : -1;
  const excessAnnualizedReturn =
    benchmarkAnnualizedReturn === undefined
      ? undefined
      : annualizedReturn - benchmarkAnnualizedReturn;
  const informationRatio =
    excessReturns.length === 0
      ? undefined
      : safeDivide(mean(excessReturns) * 252, standardDeviation(excessReturns) * Math.sqrt(252));

  return {
    totalReturn,
    annualizedReturn,
    annualizedVolatility,
    maxDrawdown: maxCurveDrawdown,
    sharpe: safeDivide(annualizedReturn, annualizedVolatility),
    calmar: safeDivide(annualizedReturn, maxCurveDrawdown),
    winRate: activeDays === 0 ? 0 : positiveDays / activeDays,
    rebalanceCount: rebalances.length,
    averageTurnover,
    benchmarkTotalReturn,
    excessAnnualizedReturn,
    informationRatio
  };
}

function buildBenchmark(
  barsBySymbol: Map<string, MarketBar[]>,
  closeLookup: CloseLookup,
  profiles: EtfProfile[],
  universe: string[],
  dates: string[],
  startIndex: number,
  cashReturnAnnual: number,
  benchmarkSymbol?: string
): BenchmarkBuildResult {
  const profileBySymbol = new Map(profiles.map((profile) => [profile.symbol, profile]));
  const requestedSymbol = benchmarkSymbol ?? defaultBenchmarkSymbol;
  const useUniverse = requestedSymbol === universeEqualWeightBenchmark;
  const hasRequestedSymbol = barsBySymbol.has(requestedSymbol);
  const symbols =
    !useUniverse && hasRequestedSymbol
      ? [requestedSymbol]
      : universe.filter((symbol) => barsBySymbol.has(symbol));
  const name =
    !useUniverse && hasRequestedSymbol
      ? `${profileBySymbol.get(requestedSymbol)?.name ?? requestedSymbol}（${requestedSymbol}）`
      : "ETF池等权基准";
  const warning =
    !useUniverse && !hasRequestedSymbol
      ? `基准 ${requestedSymbol} 缺少行情，已回退到 ETF 池等权基准。`
      : undefined;
  const holdings: Holding[] = symbols.map((symbol) => ({
    symbol,
    name: profileBySymbol.get(symbol)?.name ?? symbol,
    weight: symbols.length === 0 ? 0 : 1 / symbols.length
  }));
  const curve: EquityPoint[] = [];
  let equity = 1;
  let peak = 1;

  for (let index = startIndex; index < dates.length; index += 1) {
    const date = dates[index];
    const dailyReturn =
      index === startIndex
        ? 0
        : dailyPortfolioReturn(
            closeLookup,
            dates[index - 1],
            date,
            holdings,
            cashReturnAnnual
          ).dailyReturn;
    equity *= 1 + dailyReturn;
    peak = Math.max(peak, equity);
    curve.push({
      date,
      equity,
      dailyReturn,
      drawdown: drawdownAt(equity, peak)
    });
  }

  return {
    benchmark: {
      name,
      equityCurve: curve,
      metrics: calculateMetrics(curve, [])
    },
    warning
  };
}

function attachBenchmark(curve: EquityPoint[], benchmark: BenchmarkResult): EquityPoint[] {
  const benchmarkByDate = new Map(benchmark.equityCurve.map((point) => [point.date, point]));
  return curve.map((point) => {
    const benchmarkPoint = benchmarkByDate.get(point.date);
    return {
      ...point,
      benchmarkEquity: benchmarkPoint?.equity,
      excessReturn: benchmarkPoint ? point.equity - benchmarkPoint.equity : undefined
    };
  });
}

function warmupLength(config: BaseStrategyConfig): number {
  const factorWindows = config.factors
    .map((factor) => factor.params?.window)
    .filter((value): value is number => typeof value === "number");
  const filterWindows = config.filters
    .map((filter) => filter.params?.window)
    .filter((value): value is number => typeof value === "number");

  return Math.max(30, ...factorWindows, ...filterWindows) + 2;
}

function resolveBacktestRange(allDates: string[], config: BaseStrategyConfig): BacktestRange {
  const warnings: string[] = [];

  if (
    config.backtestStartDate &&
    config.backtestEndDate &&
    config.backtestStartDate > config.backtestEndDate
  ) {
    return {
      dates: [],
      startIndex: 0,
      warnings: ["回测开始日期不能晚于结束日期。"]
    };
  }

  const dates = config.backtestEndDate
    ? allDates.filter((date) => date <= config.backtestEndDate!)
    : allDates;

  if (dates.length === 0) {
    return {
      dates,
      startIndex: 0,
      warnings: ["回测区间没有可用行情，请调整结束日期。"]
    };
  }

  const warmupIndex = Math.min(warmupLength(config), Math.max(0, dates.length - 2));
  let startIndex = warmupIndex;

  if (config.backtestStartDate) {
    const requestedStartIndex = dates.findIndex((date) => date >= config.backtestStartDate!);
    if (requestedStartIndex < 0) {
      return {
        dates: [],
        startIndex: 0,
        warnings: ["回测区间没有可用行情，请调整开始日期。"]
      };
    }

    startIndex = Math.max(warmupIndex, requestedStartIndex);
    if (requestedStartIndex < warmupIndex) {
      warnings.push(`因子需要预热，实际回测从 ${dates[startIndex]} 开始。`);
    }
  }

  return { dates, startIndex, warnings };
}

function warningsFrom(...collections: string[][]): string[] {
  return [...new Set(collections.flat())];
}

function emptyBacktestResult(warnings: string[]): BacktestResult {
  return {
    equityCurve: [],
    rebalances: [],
    metrics: calculateMetrics([], []),
    latestSignal: {
      date: "",
      holdings: [],
      rankings: [],
      nextRebalanceHint: "请先调整回测区间"
    },
    warnings
  };
}

function runBaseBacktest(input: RunBacktestInput & { config: BaseStrategyConfig }): BacktestResult {
  const barsBySymbol = groupBarsBySymbol(input.bars);
  const closeLookup = createCloseLookup(input.bars);
  const marketLookup = createMarketLookup(input.bars);
  const range = resolveBacktestRange(uniqueSortedDates(input.bars), input.config);
  const { dates, startIndex } = range;

  if (dates.length === 0 || startIndex >= dates.length) {
    return emptyBacktestResult(range.warnings);
  }

  const execution = defaultExecution(input.config);
  const benchmarkBuild = buildBenchmark(
    barsBySymbol,
    closeLookup,
    input.profiles,
    input.config.universe,
    dates,
    startIndex,
    input.config.risk.cashReturnAnnual,
    input.config.benchmarkSymbol
  );
  const benchmark = benchmarkBuild.benchmark;
  const curve: EquityPoint[] = [];
  const rebalances: RebalanceEvent[] = [];
  const warnings: string[] = [...range.warnings];
  if (benchmarkBuild.warning) {
    warnings.push(benchmarkBuild.warning);
  }
  let pendingRebalance: PendingRebalance | null = null;
  let holdings: Holding[] = [];
  let equity = 1;
  let peak = 1;

  for (let index = startIndex; index < dates.length; index += 1) {
    const date = dates[index];
    const dayStartingEquity = equity;

    if (index > startIndex) {
      const previousDate = dates[index - 1];
      const pendingTrade = pendingRebalance as PendingRebalance | null;
      const tradesToday = pendingTrade?.tradeDate === date;

      if (tradesToday && pendingTrade && execution.price === "next_open") {
        const overnight = portfolioPeriodReturn(
          marketLookup,
          previousDate,
          "close",
          date,
          "open",
          holdings,
          input.config.risk.cashReturnAnnual,
          0.5
        );
        warnings.push(...overnight.warnings);
        equity *= 1 + overnight.dailyReturn;

        const trade = executeRebalance({
          previous: holdings,
          target: pendingTrade.holdings,
          marketLookup,
          previousDate,
          tradeDate: date,
          portfolioValue: execution.initialCapital * equity,
          transactionCostBps: input.config.transactionCostBps,
          execution
        });
        warnings.push(...trade.warnings);
        equity *= 1 - trade.costRate;
        holdings = trade.holdings;
        rebalances.push({
          date,
          signalDate: pendingTrade.signalDate,
          tradeDate: pendingTrade.tradeDate,
          holdings,
          rankings: pendingTrade.rankings,
          turnover: trade.turnover,
          tradedWeight: trade.tradedWeight,
          costBps: input.config.transactionCostBps,
          slippageBps: execution.slippageBps,
          costRate: trade.costRate,
          commissionAmount: trade.commissionAmount,
          fillRate: trade.fillRate,
          constraintCount: trade.constraintCount
        });
        pendingRebalance = null;

        const intraday = portfolioPeriodReturn(
          marketLookup,
          date,
          "open",
          date,
          "close",
          holdings,
          input.config.risk.cashReturnAnnual,
          0.5
        );
        warnings.push(...intraday.warnings);
        equity *= 1 + intraday.dailyReturn;
      } else {
        const dailyResult = portfolioPeriodReturn(
          marketLookup,
          previousDate,
          "close",
          date,
          "close",
          holdings,
          input.config.risk.cashReturnAnnual
        );
        warnings.push(...dailyResult.warnings);
        equity *= 1 + dailyResult.dailyReturn;

        if (tradesToday && pendingTrade) {
          const trade = executeRebalance({
            previous: holdings,
            target: pendingTrade.holdings,
            marketLookup,
            previousDate,
            tradeDate: date,
            portfolioValue: execution.initialCapital * equity,
            transactionCostBps: input.config.transactionCostBps,
            execution
          });
          warnings.push(...trade.warnings);
          equity *= 1 - trade.costRate;
          holdings = trade.holdings;
          rebalances.push({
            date,
            signalDate: pendingTrade.signalDate,
            tradeDate: pendingTrade.tradeDate,
            holdings,
            rankings: pendingTrade.rankings,
            turnover: trade.turnover,
            tradedWeight: trade.tradedWeight,
            costBps: input.config.transactionCostBps,
            slippageBps: execution.slippageBps,
            costRate: trade.costRate,
            commissionAmount: trade.commissionAmount,
            fillRate: trade.fillRate,
            constraintCount: trade.constraintCount
          });
          pendingRebalance = null;
        }
      }
    }

    peak = Math.max(peak, equity);
    curve.push({
      date,
      equity,
      dailyReturn: dayStartingEquity === 0 ? 0 : equity / dayStartingEquity - 1,
      drawdown: drawdownAt(equity, peak)
    });

    if (shouldRebalance(dates, index, input.config.rebalance, holdings.length > 0)) {
      const evaluation = evaluateUniverse({
        barsBySymbol,
        profiles: input.profiles,
        config: input.config,
        date
      });
      warnings.push(...evaluation.warnings);

      const nextHoldings = holdingsFromRows(evaluation.rows, input.config, input.profiles);
      const tradeDate = dates[index + 1];
      if (tradeDate) {
        pendingRebalance = {
          signalDate: date,
          tradeDate,
          holdings: nextHoldings,
          rankings: evaluation.rows
        };
      } else {
        warnings.push(`${date} 已是最后一个交易日，信号仅用于跟踪，不纳入回测成交。`);
      }
    }
  }

  const latestDate = dates.at(-1) ?? "";
  const latestEvaluation = evaluateUniverse({
    barsBySymbol,
    profiles: input.profiles,
    config: input.config,
    date: latestDate
  });
  warnings.push(...latestEvaluation.warnings);

  const latestRebalance = rebalances.at(-1);
  const latestHoldings =
    latestEvaluation.rows.length > 0
      ? holdingsFromRows(latestEvaluation.rows, input.config, input.profiles)
      : latestRebalance?.holdings ?? holdings;
  const equityCurve = attachBenchmark(curve, benchmark);

  return {
    equityCurve,
    rebalances,
    metrics: calculateMetrics(equityCurve, rebalances, benchmark.equityCurve),
    benchmark,
    latestSignal: {
      date: latestDate,
      holdings: latestHoldings,
      rankings: latestEvaluation.rows,
      nextRebalanceHint: `${nextRebalanceHint(input.config.rebalance)}；信号收盘后生成，下一交易日${execution.price === "next_close" ? "收盘" : "开盘"}成交`
    },
    warnings: warningsFrom(warnings)
  };
}

function normalizeComponents(config: CompositeStrategyConfig, strategyBook: StrategyConfig[]) {
  const book = new Map(strategyBook.map((strategy) => [strategy.id, strategy]));
  const components = config.components
    .map((component) => ({
      ...component,
      strategy: book.get(component.strategyId)
    }))
    .filter(
      (component): component is typeof component & { strategy: StrategyConfig } =>
        Boolean(component.strategy) && component.weight > 0
    )
    .filter((component) => !isCompositeStrategy(component.strategy) || component.strategy.id !== config.id);
  const totalWeight = components.reduce((total, component) => total + component.weight, 0);

  if (totalWeight <= 0) {
    return [];
  }

  return components.map((component) => ({
    ...component,
    normalizedWeight: component.weight / totalWeight
  }));
}

function aggregateHoldings(
  childResults: Array<{ weight: number; result: BacktestResult }>
): Holding[] {
  const holdings = new Map<string, Holding>();

  for (const child of childResults) {
    for (const holding of child.result.latestSignal.holdings) {
      const current = holdings.get(holding.symbol) ?? {
        symbol: holding.symbol,
        name: holding.name,
        weight: 0
      };
      holdings.set(holding.symbol, {
        ...current,
        weight: current.weight + child.weight * holding.weight
      });
    }
  }

  return [...holdings.values()]
    .filter((holding) => holding.weight > 0.0001)
    .sort((left, right) => right.weight - left.weight);
}

function compositeRebalances(
  childResults: Array<{ weight: number; result: BacktestResult }>,
  costBps: number,
  slippageBps: number
): RebalanceEvent[] {
  const rebalancesByDate = new Map<
    string,
    { turnover: number; signalDate?: string }
  >();

  for (const child of childResults) {
    for (const event of child.result.rebalances) {
      const current = rebalancesByDate.get(event.date) ?? { turnover: 0 };
      rebalancesByDate.set(event.date, {
        turnover: current.turnover + child.weight * event.turnover,
        signalDate:
          event.signalDate && (!current.signalDate || event.signalDate > current.signalDate)
            ? event.signalDate
            : current.signalDate
      });
    }
  }

  return [...rebalancesByDate.entries()]
    .filter(([, event]) => event.turnover > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, event]) => ({
      date,
      signalDate: event.signalDate,
      tradeDate: date,
      holdings: [],
      rankings: [],
      turnover: event.turnover,
      tradedWeight: event.turnover * 2,
      costBps,
      slippageBps
    }));
}

function runCompositeBacktest(input: RunBacktestInput & { config: CompositeStrategyConfig }): BacktestResult {
  const components = normalizeComponents(input.config, input.strategyBook ?? []);
  const warnings: string[] = [];

  if (components.length === 0) {
    warnings.push("组合策略至少需要一个有效的子策略和权重。");
    return {
      equityCurve: [],
      rebalances: [],
      metrics: calculateMetrics([], []),
      latestSignal: {
        date: "",
        holdings: [],
        rankings: [],
        nextRebalanceHint: "请先配置子策略"
      },
      warnings
    };
  }

  const childResults = components.map((component) => {
    const childConfig = {
      ...component.strategy,
      backtestStartDate: input.config.backtestStartDate,
      backtestEndDate: input.config.backtestEndDate
    } as StrategyConfig;
    const result = runBacktest({
      bars: input.bars,
      profiles: input.profiles,
      config: childConfig,
      strategyBook: input.strategyBook
    });
    warnings.push(
      ...result.warnings.map((warning) => `${component.strategy.name}: ${warning}`)
    );
    return { weight: component.normalizedWeight, strategy: component.strategy, result };
  });
  const execution = defaultExecution(input.config);
  const rebalances = compositeRebalances(
    childResults,
    input.config.transactionCostBps,
    execution.slippageBps
  );
  const rebalanceByDate = new Map(rebalances.map((event) => [event.date, event]));

  const commonDates = childResults
    .map((child) => new Set(child.result.equityCurve.map((point) => point.date)))
    .reduce<string[]>((dates, dateSet, index) => {
      if (index === 0) {
        return [...dateSet];
      }
      return dates.filter((date) => dateSet.has(date));
    }, [])
    .sort();
  const childCurveByDate = childResults.map((child) => ({
    ...child,
    curveByDate: new Map(child.result.equityCurve.map((point) => [point.date, point]))
  }));
  let equity = 1;
  let peak = 1;
  const equityCurve: EquityPoint[] = [];

  for (let index = 0; index < commonDates.length; index += 1) {
    const date = commonDates[index];
    const childDailyReturn =
      index === 0
        ? 0
        : childCurveByDate.reduce(
            (total, child) =>
              total + child.weight * (child.curveByDate.get(date)?.dailyReturn ?? 0),
            0
          );
    const costEvent = rebalanceByDate.get(date);
    const tradedWeight = costEvent?.tradedWeight ?? 0;
    const portfolioValue = Math.max(1, execution.initialCapital * equity);
    const commissionAmount =
      tradedWeight > 0
        ? Math.max(
            (portfolioValue * tradedWeight * input.config.transactionCostBps) / 10_000,
            execution.minimumCommission
          )
        : 0;
    const costRate = Math.min(
      0.99,
      commissionAmount / portfolioValue +
        (tradedWeight * execution.slippageBps) / 10_000
    );
    if (costEvent) {
      costEvent.costRate = costRate;
      costEvent.commissionAmount = commissionAmount;
      costEvent.fillRate = 1;
      costEvent.constraintCount = 0;
    }
    const dailyReturn = (1 + childDailyReturn) * (1 - costRate) - 1;

    equity *= 1 + dailyReturn;
    peak = Math.max(peak, equity);
    equityCurve.push({
      date,
      equity,
      dailyReturn,
      drawdown: drawdownAt(equity, peak)
    });
  }

  const latestHoldings = aggregateHoldings(childResults);
  const rankings = latestHoldings.map((holding, index) => ({
    symbol: holding.symbol,
    name: holding.name,
    category: "组合持仓",
    score: holding.weight,
    passesFilters: true,
    factorScores: {},
    filterValues: {}
  }));

  const benchmarkUniverse = [
    ...new Set(
      components.flatMap((component) =>
        isBaseStrategy(component.strategy) ? component.strategy.universe : []
      )
    )
  ];
  const benchmarkBuild = buildBenchmark(
    groupBarsBySymbol(input.bars),
    createCloseLookup(input.bars),
    input.profiles,
    benchmarkUniverse.length > 0
      ? benchmarkUniverse
      : input.profiles.map((profile) => profile.symbol),
    commonDates,
    0,
    input.config.risk.cashReturnAnnual,
    input.config.benchmarkSymbol
  );
  if (benchmarkBuild.warning) {
    warnings.push(benchmarkBuild.warning);
  }
  const curveWithBenchmark = attachBenchmark(equityCurve, benchmarkBuild.benchmark);

  return {
    equityCurve: curveWithBenchmark,
    rebalances,
    metrics: calculateMetrics(
      curveWithBenchmark,
      rebalances,
      benchmarkBuild.benchmark.equityCurve
    ),
    benchmark: benchmarkBuild.benchmark,
    latestSignal: {
      date: equityCurve.at(-1)?.date ?? "",
      holdings: latestHoldings,
      rankings,
      nextRebalanceHint: "跟随子策略调仓"
    },
    warnings: [...new Set(warnings)]
  };
}

export function runBacktest(input: RunBacktestInput): BacktestResult {
  if (isCompositeStrategy(input.config)) {
    return runCompositeBacktest({ ...input, config: input.config });
  }

  return runBaseBacktest({ ...input, config: input.config });
}
