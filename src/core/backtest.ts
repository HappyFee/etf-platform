import { shouldRebalance } from "./date";
import { evaluateUniverse } from "./factors";
import { maxDrawdown, mean, rollingReturns, safeDivide, standardDeviation } from "./math";
import { groupBarsBySymbol } from "./sampleData";
import type {
  BacktestMetrics,
  BacktestResult,
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

function holdingsFromRows(rows: EvaluationRow[], config: StrategyConfig): Holding[] {
  const selected = rows.slice(0, Math.max(0, config.portfolio.topN));
  if (selected.length === 0) {
    return [];
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

function warmupLength(config: StrategyConfig): number {
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

export function runBacktest(input: RunBacktestInput): BacktestResult {
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

    if (shouldRebalance(dates, index, input.config.rebalance.frequency, holdings.length > 0)) {
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
      nextRebalanceHint:
        input.config.rebalance.frequency === "weekly"
          ? "下一个交易周首日"
          : input.config.rebalance.frequency === "monthly"
            ? "下一个交易月首日"
            : "下一个交易日"
    },
    warnings: warningsFrom(warnings)
  };
}
