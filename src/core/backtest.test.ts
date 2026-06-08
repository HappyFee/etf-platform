import { describe, expect, test } from "vitest";
import { runBacktest } from "./backtest";
import { defaultCompositeStrategy, defaultStrategy, defensiveStrategy } from "./defaultStrategy";
import { etfProfiles, marketBars } from "./sampleData";

describe("backtest engine", () => {
  test("runs a complete weekly ETF rotation backtest with metrics and signals", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultStrategy
    });

    expect(result.equityCurve.length).toBeGreaterThan(250);
    expect(result.rebalances.length).toBeGreaterThan(20);
    expect(result.metrics.totalReturn).toBeGreaterThan(-1);
    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.benchmark?.equityCurve.length).toBe(result.equityCurve.length);
    expect(result.metrics.benchmarkTotalReturn).toBeTypeOf("number");
    expect(result.latestSignal.holdings.length).toBeLessThanOrEqual(
      defaultStrategy.portfolio.topN
    );
    expect(result.latestSignal.rankings.length).toBeGreaterThan(0);
  });

  test("returns warnings when filters remove every ETF", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        filters: [
          {
            factorId: "amount_ma20",
            operator: ">",
            value: Number.MAX_SAFE_INTEGER,
            params: { window: 20 }
          }
        ]
      }
    });

    expect(result.warnings.some((warning) => warning.includes("过滤"))).toBe(true);
    expect(result.latestSignal.holdings).toEqual([]);
  });

  test("does not create holdings when every factor is disabled", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        factors: defaultStrategy.factors.map((factor) => ({
          ...factor,
          enabled: false
        }))
      }
    });

    expect(result.latestSignal.holdings).toEqual([]);
    expect(result.rebalances.every((event) => event.holdings.length === 0)).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("因子"))).toBe(true);
  });

  test("keeps current holdings when latest candidate ranking is empty between rebalances", () => {
    const latestDate = marketBars.at(-1)!.date;
    const stressedBars = marketBars.map((bar) =>
      bar.date === latestDate
        ? {
            ...bar,
            open: 0.0001,
            high: 0.0001,
            low: 0.0001,
            close: 0.0001
          }
        : bar
    );

    const result = runBacktest({
      bars: stressedBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        filters: [
          {
            factorId: "close_ma20_ratio",
            operator: ">",
            value: -0.99,
            params: { window: 20 }
          }
        ]
      }
    });

    const latestRebalance = result.rebalances.at(-1)!;

    expect(latestRebalance.date).not.toBe(latestDate);
    expect(latestRebalance.holdings.length).toBeGreaterThan(0);
    expect(result.latestSignal.rankings).toEqual([]);
    expect(result.latestSignal.holdings).toEqual(latestRebalance.holdings);
  });

  test("records transaction costs in the rebalance day's daily return", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        transactionCostBps: 1000
      }
    });

    const firstRebalance = result.rebalances.find((event) => event.turnover > 0)!;
    const curvePoint = result.equityCurve.find(
      (point) => point.date === firstRebalance.date
    )!;

    expect(firstRebalance.signalDate).not.toBe(firstRebalance.tradeDate);
    expect(firstRebalance.costBps).toBe(1000);
    expect(firstRebalance.slippageBps).toBeGreaterThan(0);
    expect(curvePoint.dailyReturn).toBeLessThan(0);
  });

  test("allocates fixed rank weights to selected ETFs", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        portfolio: {
          topN: 3,
          weighting: "fixed",
          fixedWeights: [0.5, 0.3, 0.2]
        }
      }
    });

    expect(result.latestSignal.holdings.map((holding) => holding.weight)).toEqual([
      0.5,
      0.3,
      0.2
    ]);
  });

  test("applies max position and minimum cash constraints to selected ETF weights", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        portfolio: {
          topN: 3,
          weighting: "fixed",
          fixedWeights: [0.7, 0.2, 0.1]
        },
        risk: {
          ...defaultStrategy.risk,
          maxPositionWeight: 0.4,
          minCashWeight: 0.1
        }
      }
    });

    expect(result.latestSignal.holdings.every((holding) => holding.weight <= 0.4)).toBe(
      true
    );
    expect(
      result.latestSignal.holdings.reduce((total, holding) => total + holding.weight, 0)
    ).toBeCloseTo(0.9, 6);
  });

  test("warns and accrues cash return when a held ETF is missing a daily bar", () => {
    const baseline = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultStrategy
    });
    const latestDate = marketBars.at(-1)!.date;
    const heldSymbol = baseline.latestSignal.holdings[0].symbol;

    const result = runBacktest({
      bars: marketBars.filter(
        (bar) => !(bar.symbol === heldSymbol && bar.date === latestDate)
      ),
      profiles: etfProfiles,
      config: defaultStrategy
    });

    expect(result.warnings.some((warning) => warning.includes("缺少行情"))).toBe(true);
  });

  test("combines multiple base strategies into a composite strategy", () => {
    const baseResult = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultStrategy
    });
    const defensiveResult = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: defensiveStrategy
    });
    const compositeResult = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultCompositeStrategy,
      strategyBook: [defaultStrategy, defensiveStrategy, defaultCompositeStrategy]
    });

    expect(compositeResult.equityCurve.length).toBeGreaterThan(250);
    expect(compositeResult.latestSignal.date).toBe(marketBars.at(-1)!.date);
    expect(compositeResult.latestSignal.holdings.length).toBeGreaterThan(0);
    expect(compositeResult.metrics.totalReturn).toBeGreaterThan(
      Math.min(baseResult.metrics.totalReturn, defensiveResult.metrics.totalReturn) - 0.1
    );
    expect(compositeResult.metrics.totalReturn).toBeLessThan(
      Math.max(baseResult.metrics.totalReturn, defensiveResult.metrics.totalReturn) + 0.1
    );
  });
});
