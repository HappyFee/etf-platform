import { nextRebalanceHint, shouldRebalance } from "./date";
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

interface PendingRebalance {
  signalDate: string;
  tradeDate: string;
  holdings: Holding[];
  rankings: EvaluationRow[];
}

function uniqueSortedDates(bars: MarketBar[]): string[] {
  return [...new Set(bars.map((bar) => bar.date))].sort();
}

function getClose(barsBySymbol: Map<string, MarketBar[]>, symbol: string, date: string): number | null {
  const bars = barsBySymbol.get(symbol);
  const bar = bars?.find((item) => item.date === date);
  return bar?.close ?? null;
}

function defaultExecution(config: StrategyConfig): ExecutionConfig {
  return {
    price: config.execution?.price ?? "next_close",
    slippageBps: Math.max(0, config.execution?.slippageBps ?? 3)
  };
}

function dailyPortfolioReturn(
  barsBySymbol: Map<string, MarketBar[]>,
  previousDate: string,
  currentDate: string,
  holdings: Holding[],
  cashReturnAnnual: number
): DailyPortfolioReturn {
  const cashDailyReturn = cashReturnAnnual / 252;

  if (holdings.length === 0) {
    return { dailyReturn: cashDailyReturn, warnings: [] };
  }

  const warnings: string[] = [];
  const investedWeight = holdings.reduce((total, holding) => total + holding.weight, 0);
  const cashWeight = Math.max(0, 1 - investedWeight);
  const dailyReturn = holdings.reduce((total, holding) => {
    const previous = getClose(barsBySymbol, holding.symbol, previousDate);
    const current = getClose(barsBySymbol, holding.symbol, currentDate);
    if (!previous || !current) {
      warnings.push(
        `${currentDate} ${holding.symbol} 缺少行情，按现金收益处理。`
      );
      return total + holding.weight * cashDailyReturn;
    }
    return total + holding.weight * (current / previous - 1);
  }, cashWeight * cashDailyReturn);

  return { dailyReturn, warnings };
}

function isCompositeStrategy(config: StrategyConfig): config is CompositeStrategyConfig {
  return config.kind === "composite";
}

function isBaseStrategy(config: StrategyConfig): config is BaseStrategyConfig {
  return config.kind !== "composite";
}

function holdingsFromRows(rows: EvaluationRow[], config: BaseStrategyConfig): Holding[] {
  const selected = rows.slice(0, Math.max(0, config.portfolio.topN));
  if (selected.length === 0) {
    return [];
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
      return applyRiskConstraints(holdings, config);
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
      return applyRiskConstraints(holdings, config);
    }
  }

  holdings = selected.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    weight: 1 / selected.length
  }));
  return applyRiskConstraints(holdings, config);
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

function calculateTurnover(previous: Holding[], next: Holding[]): number {
  const symbols = new Set([...previous.map((item) => item.symbol), ...next.map((item) => item.symbol)]);
  let turnover = 0;

  for (const symbol of symbols) {
    const previousWeight = previous.find((item) => item.symbol === symbol)?.weight ?? 0;
    const nextWeight = next.find((item) => item.symbol === symbol)?.weight ?? 0;
    turnover += Math.abs(nextWeight - previousWeight);
  }

  return turnover / 2;
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
  profiles: EtfProfile[],
  universe: string[],
  dates: string[],
  startIndex: number,
  cashReturnAnnual: number
): BenchmarkResult {
  const symbols = universe.filter((symbol) => barsBySymbol.has(symbol));
  const profileBySymbol = new Map(profiles.map((profile) => [profile.symbol, profile]));
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
            barsBySymbol,
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
    name: "ETF池等权基准",
    equityCurve: curve,
    metrics: calculateMetrics(curve, [])
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

function warningsFrom(...collections: string[][]): string[] {
  return [...new Set(collections.flat())];
}

function runBaseBacktest(input: RunBacktestInput & { config: BaseStrategyConfig }): BacktestResult {
  const barsBySymbol = groupBarsBySymbol(input.bars);
  const dates = uniqueSortedDates(input.bars);
  const startIndex = Math.min(warmupLength(input.config), Math.max(0, dates.length - 2));
  const execution = defaultExecution(input.config);
  const benchmark = buildBenchmark(
    barsBySymbol,
    input.profiles,
    input.config.universe,
    dates,
    startIndex,
    input.config.risk.cashReturnAnnual
  );
  const curve: EquityPoint[] = [];
  const rebalances: RebalanceEvent[] = [];
  const warnings: string[] = [];
  let pendingRebalance: PendingRebalance | null = null;
  let holdings: Holding[] = [];
  let equity = 1;
  let peak = 1;

  for (let index = startIndex; index < dates.length; index += 1) {
    const date = dates[index];

    if (index === startIndex) {
      curve.push({ date, equity, dailyReturn: 0, drawdown: 0 });
    } else {
      const dailyResult = dailyPortfolioReturn(
        barsBySymbol,
        dates[index - 1],
        date,
        holdings,
        input.config.risk.cashReturnAnnual
      );
      const dailyReturn = dailyResult.dailyReturn;
      warnings.push(...dailyResult.warnings);
      equity *= 1 + dailyReturn;
      peak = Math.max(peak, equity);
      curve.push({
        date,
        equity,
        dailyReturn,
        drawdown: drawdownAt(equity, peak)
      });
    }

    if (pendingRebalance && pendingRebalance.tradeDate === date) {
      const nextHoldings = pendingRebalance.holdings;
      const turnover = calculateTurnover(holdings, nextHoldings);
      const totalCostBps = input.config.transactionCostBps + execution.slippageBps;
      const previousCurvePoint = curve.length > 1 ? curve[curve.length - 2] : undefined;
      const dayStartingEquity = previousCurvePoint?.equity ?? 1;
      equity *= 1 - (turnover * totalCostBps) / 10_000;
      peak = Math.max(peak, equity);
      const latestPoint = curve.at(-1);
      if (latestPoint) {
        latestPoint.equity = equity;
        latestPoint.dailyReturn =
          dayStartingEquity === 0 ? 0 : equity / dayStartingEquity - 1;
        latestPoint.drawdown = drawdownAt(equity, peak);
      }

      holdings = nextHoldings;
      rebalances.push({
        date,
        signalDate: pendingRebalance.signalDate,
        tradeDate: pendingRebalance.tradeDate,
        holdings,
        rankings: pendingRebalance.rankings,
        turnover,
        costBps: input.config.transactionCostBps,
        slippageBps: execution.slippageBps
      });
      pendingRebalance = null;
    }

    if (shouldRebalance(dates, index, input.config.rebalance, holdings.length > 0)) {
      const evaluation = evaluateUniverse({
        barsBySymbol,
        profiles: input.profiles,
        config: input.config,
        date
      });
      warnings.push(...evaluation.warnings);

      const nextHoldings = holdingsFromRows(evaluation.rows, input.config);
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
      ? holdingsFromRows(latestEvaluation.rows, input.config)
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
    const result = runBacktest({
      bars: input.bars,
      profiles: input.profiles,
      config: component.strategy,
      strategyBook: input.strategyBook
    });
    warnings.push(
      ...result.warnings.map((warning) => `${component.strategy.name}: ${warning}`)
    );
    return { weight: component.normalizedWeight, strategy: component.strategy, result };
  });

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
    const dailyReturn =
      index === 0
        ? 0
        : childCurveByDate.reduce(
            (total, child) =>
              total + child.weight * (child.curveByDate.get(date)?.dailyReturn ?? 0),
            0
          );

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

  return {
    equityCurve,
    rebalances: [],
    metrics: calculateMetrics(equityCurve, []),
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
