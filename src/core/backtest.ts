import { nextRebalanceHint, shouldRebalance } from "./date";
import { evaluateUniverse } from "./factors";
import { maxDrawdown, mean, rollingReturns, safeDivide, standardDeviation } from "./math";
import { groupBarsBySymbol } from "./sampleData";
import type {
  BaseStrategyConfig,
  BacktestMetrics,
  BacktestResult,
  CompositeStrategyConfig,
  EquityPoint,
  EtfProfile,
  EvaluationRow,
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

function uniqueSortedDates(bars: MarketBar[]): string[] {
  return [...new Set(bars.map((bar) => bar.date))].sort();
}

function getClose(barsBySymbol: Map<string, MarketBar[]>, symbol: string, date: string): number | null {
  const bars = barsBySymbol.get(symbol);
  const bar = bars?.find((item) => item.date === date);
  return bar?.close ?? null;
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
  }, 0);

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

  if (config.portfolio.weighting === "fixed") {
    const configuredWeights = config.portfolio.fixedWeights ?? [];
    const rawWeights = selected.map((_, index) => Math.max(0, configuredWeights[index] ?? 0));
    const totalWeight = rawWeights.reduce((total, weight) => total + weight, 0);

    if (totalWeight > 0) {
      return selected.map((row, index) => ({
        symbol: row.symbol,
        name: row.name,
        weight: rawWeights[index] / totalWeight
      }));
    }
  }

  if (config.portfolio.weighting === "score") {
    const scoreTotal = selected.reduce((total, row) => total + Math.max(0, row.score), 0);
    if (scoreTotal > 0) {
      return selected.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        weight: Math.max(0, row.score) / scoreTotal
      }));
    }
  }

  return selected.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    weight: 1 / selected.length
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

function calculateMetrics(curve: EquityPoint[], rebalances: RebalanceEvent[]): BacktestMetrics {
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

  return {
    totalReturn,
    annualizedReturn,
    annualizedVolatility,
    maxDrawdown: maxCurveDrawdown,
    sharpe: safeDivide(annualizedReturn, annualizedVolatility),
    calmar: safeDivide(annualizedReturn, maxCurveDrawdown),
    winRate: activeDays === 0 ? 0 : positiveDays / activeDays,
    rebalanceCount: rebalances.length,
    averageTurnover
  };
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
  const curve: EquityPoint[] = [];
  const rebalances: RebalanceEvent[] = [];
  const warnings: string[] = [];
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

    if (shouldRebalance(dates, index, input.config.rebalance, holdings.length > 0)) {
      const evaluation = evaluateUniverse({
        barsBySymbol,
        profiles: input.profiles,
        config: input.config,
        date
      });
      warnings.push(...evaluation.warnings);

      const nextHoldings = holdingsFromRows(evaluation.rows, input.config);
      const turnover = calculateTurnover(holdings, nextHoldings);
      const previousCurvePoint = curve.length > 1 ? curve[curve.length - 2] : undefined;
      const dayStartingEquity = previousCurvePoint?.equity ?? 1;
      equity *= 1 - (turnover * input.config.transactionCostBps) / 10_000;
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
        holdings,
        rankings: evaluation.rows,
        turnover
      });
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
    latestRebalance?.holdings ?? holdingsFromRows(latestEvaluation.rows, input.config);

  return {
    equityCurve: curve,
    rebalances,
    metrics: calculateMetrics(curve, rebalances),
    latestSignal: {
      date: latestDate,
      holdings: latestHoldings,
      rankings: latestEvaluation.rows,
      nextRebalanceHint: nextRebalanceHint(input.config.rebalance)
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
