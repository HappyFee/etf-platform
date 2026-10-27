import { describe, expect, test } from "vitest";
import { runBacktest } from "./backtest";
import { tradingDays } from "./date";
import { defaultStrategy } from "./defaultStrategy";
import { defaultRotationRules } from "./rotation";
import type { BaseStrategyConfig, EtfProfile, MarketBar } from "./types";

const dates = tradingDays("2026-01-01", "2026-03-15").slice(0, 40);
const profiles: EtfProfile[] = ["510001", "510002", "511880"].map(symbol => ({
  symbol, name: symbol, exchange: "SH", category: "ETF", trackingIndex: symbol, expenseRatio: 0
}));

function fixture() {
  const bars: MarketBar[] = profiles.flatMap(profile => dates.map(date => ({
    symbol: profile.symbol, date, open: 100, high: 100, low: 100, close: 100,
    volume: 1_000_000, amount: 100_000_000
  })));
  const config: BaseStrategyConfig = {
    ...defaultStrategy, universe: ["510001", "510002"], factors: [], filters: [],
    rotationRules: { ...defaultRotationRules, window: 1,
      buy: { rankFrom: 1, rankTo: 1, maxNewPositions: 1 },
      sell: { rankBelow: 1, match: "any" } },
    rebalance: { frequency: "daily" },
    portfolio: { topN: 1, weighting: "equal", investedWeight: 0.5 },
    risk: { cashReturnAnnual: 0, maxPositionWeight: 0.5 }, transactionCostBps: 0,
    execution: { price: "next_close", slippageBps: 0, initialCapital: 10_000,
      minimumCommission: 5, maxParticipationRate: 0, priceLimitThreshold: 0 }
  };
  return { bars, config };
}

function setPrice(bars: MarketBar[], symbol: string, from: number, price: number) {
  for (const bar of bars) {
    if (bar.symbol === symbol && bar.date >= dates[from]) {
      Object.assign(bar, { open: price, high: price, low: price, close: price });
    }
  }
}

describe("trading boundary integration", () => {
  test("a blocked sell cannot finance risk buys beyond the configured strategy allocation", () => {
    const { bars, config } = fixture();
    config.universe = profiles.map(p => p.symbol);
    config.portfolio = { topN: 3, weighting: "equal", investedWeight: 0.6 };
    config.risk.maxPositionWeight = 1;
    config.rotationRules = { ...config.rotationRules!,
      buy: { rankFrom: 1, rankTo: 2, maxNewPositions: 2 }, sell: { rankBelow: 2, match: "any" } };
    config.execution!.priceLimitThreshold = 0.1;
    setPrice(bars, "510001", 34, 90);
    setPrice(bars, "511880", 34, 110);
    setPrice(bars, "510001", 35, 80);
    const result = runBacktest({ bars, profiles, config });
    const event = result.rebalances.find(e => e.date === dates[35])!;
    expect(event.holdings.some(h => h.symbol === "510001")).toBe(true);
    expect(event.holdings.reduce((sum, h) => sum + h.weight, 0)).toBeLessThanOrEqual(0.600000001);
    expect(result.warnings.some(w => w.includes("策略持仓比例上限"))).toBe(true);
  });
  test.each(["window", "buyLimit", "sellThreshold"])("invalid %s reports a rule error and cannot generate orders", key => {
    const { bars, config } = fixture();
    if (key === "window") config.rotationRules!.window = NaN;
    if (key === "buyLimit") config.rotationRules!.buy.maxNewPositions = Infinity;
    if (key === "sellThreshold") config.rotationRules!.sell.returnBelow = NaN;
    const result = runBacktest({ bars, profiles, config });
    expect(result.rebalances).toEqual([]);
    expect(result.latestSignal.holdings).toEqual([]);
    expect(result.warnings.some(w => w.includes("策略规则无效"))).toBe(true);
  });
  test("redistributes capped fixed weights until the feasible strategy allocation is filled", () => {
    const { bars, config } = fixture();
    config.universe = profiles.map(p => p.symbol);
    config.portfolio = { topN: 3, weighting: "fixed", fixedWeights: [0.9, 0.09, 0.01], investedWeight: 1 };
    config.risk.maxPositionWeight = 0.4;
    config.rotationRules = { ...config.rotationRules!,
      buy: { rankFrom: 1, rankTo: 3, maxNewPositions: 3 }, sell: { match: "any" } };
    const result = runBacktest({ bars, profiles, config });
    expect(result.latestSignal.holdings).toHaveLength(3);
    [0.4, 0.4, 0.2].forEach((weight, index) =>
      expect(result.latestSignal.holdings[index].weight).toBeCloseTo(weight, 12));
    expect(result.latestSignal.holdings.reduce((sum, h) => sum + h.weight, 0)).toBeCloseTo(1, 12);
  });

  test("a stopped execution bar cannot fill even when the participation limit is disabled", () => {
    const { bars, config } = fixture();
    bars.find(b => b.symbol === "510001" && b.date === dates[33])!.volume = 0;
    const result = runBacktest({ bars, profiles, config });
    expect(result.rebalances[0].holdings).toEqual([]);
    expect(result.rebalances[0].commissionAmount).toBe(0);
  });
  test("an asset used as cash replacement never competes for rotation rank or creates duplicate orders", () => {
    const { bars, config } = fixture();
    config.risk.cashReplacementSymbol = "510001";
    const result = runBacktest({ bars, profiles, config });
    expect(result.latestSignal.rankings.map(r => r.symbol)).toEqual(["510002"]);
    expect(result.rebalances[0].holdings.map(h => h.symbol).sort()).toEqual(["510001", "510002"]);
    expect(result.rebalances[0].commissionAmount).toBe(10);
    expect(result.rebalances.slice(1).every(e => e.commissionAmount === 0)).toBe(true);
  });

  test("a replacement asset does not consume a strategy slot when selling the old ETF is blocked", () => {
    const { bars, config } = fixture();
    config.risk.cashReplacementSymbol = "511880";
    config.execution!.priceLimitThreshold = 0.1;
    setPrice(bars, "510001", 34, 90);
    setPrice(bars, "510002", 34, 110);
    setPrice(bars, "510001", 35, 80);
    const result = runBacktest({ bars, profiles, config });
    expect(result.rebalances[0].holdings).toHaveLength(2);
    const event = result.rebalances.find(e => e.date === dates[35])!;
    expect(event.holdings.map(h => h.symbol).sort()).toEqual(["510001", "511880"]);
    expect(event.holdings.reduce((sum, h) => sum + h.weight, 0)).toBeLessThanOrEqual(1.000000001);
  });
  test("keeps the same ETF without a round-trip or repeated commission when its weight is unchanged", () => {
    const { bars, config } = fixture();
    const result = runBacktest({ bars, profiles, config });
    expect(result.rebalances[0].commissionAmount).toBe(5);
    for (const event of result.rebalances.slice(1)) {
      expect(event.tradedWeight).toBeCloseTo(0, 12);
      expect(event.commissionAmount).toBe(0);
      expect(event.holdings.map(h => h.symbol)).toEqual(["510001"]);
    }
  });

  test("nets same-ETF target changes after price drift and charges only the two net orders", () => {
    const { bars, config } = fixture();
    config.portfolio = { topN: 2, weighting: "equal", investedWeight: 1 };
    config.risk.maxPositionWeight = 1;
    config.rotationRules = { ...config.rotationRules!,
      buy: { rankFrom: 1, rankTo: 2, maxNewPositions: 2 }, sell: { match: "any" } };
    setPrice(bars, "510001", 34, 200);
    const result = runBacktest({ bars, profiles, config });
    const event = result.rebalances.find(e => e.date === dates[34])!;
    expect(event.holdings).toHaveLength(2);
    expect(event.tradedWeight).toBeCloseTo(1 / 3, 8);
    expect(event.commissionAmount).toBe(10);
  });

  test("marks positions to market between cycles instead of rebalancing them for free", () => {
    const { bars, config } = fixture();
    config.rebalance = { frequency: "interval", intervalDays: 5 };
    config.backtestEndDate = dates[35];
    config.execution!.minimumCommission = 0;
    setPrice(bars, "510001", 34, 200);
    setPrice(bars, "510001", 35, 100);
    const result = runBacktest({ bars, profiles, config });
    expect(result.equityCurve.find(p => p.date === dates[34])!.equity).toBeCloseTo(1.5, 8);
    expect(result.equityCurve.at(-1)!.equity).toBeCloseTo(1, 8);
    expect(result.rebalances).toHaveLength(1);
  });

  test.each(["locked", "partial"])("does not open an extra ETF when the old position is %s", mode => {
    const { bars, config } = fixture();
    config.execution!.minimumCommission = 0;
    setPrice(bars, "510001", 34, 90);
    setPrice(bars, "510002", 34, 110);
    if (mode === "locked") {
      config.execution!.priceLimitThreshold = 0.1;
      setPrice(bars, "510001", 35, 80);
    } else {
      config.execution!.maxParticipationRate = 0.1;
      bars.find(b => b.symbol === "510001" && b.date === dates[35])!.amount = 100;
    }
    const result = runBacktest({ bars, profiles, config });
    const event = result.rebalances.find(e => e.date === dates[35])!;
    expect(event.holdings.map(h => h.symbol)).toEqual(["510001"]);
    expect(event.constraintCount).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes("持仓数量已达上限"))).toBe(true);
    expect(event.holdings.reduce((sum, h) => sum + h.weight, 0)).toBeLessThanOrEqual(1);
  });

  test("missing execution-day quotes cannot produce a fill or commission", () => {
    const { bars, config } = fixture();
    const result = runBacktest({ bars: bars.filter(b => !(b.symbol === "510001" && b.date === dates[33])), profiles, config });
    const first = result.rebalances.find(e => e.date === dates[33])!;
    expect(first.holdings).toEqual([]);
    expect(first.commissionAmount).toBe(0);
    expect(first.fillRate).toBe(0);
    expect(result.warnings.some(w => w.includes("缺少有效成交行情"))).toBe(true);
  });

  test("zero turnover cannot be treated as unlimited liquidity", () => {
    const { bars, config } = fixture();
    config.execution!.maxParticipationRate = 0.1;
    const quote = bars.find(b => b.symbol === "510001" && b.date === dates[33])!;
    quote.amount = 0;
    const result = runBacktest({ bars, profiles, config });
    expect(result.rebalances[0].holdings).toEqual([]);
    expect(result.rebalances[0].commissionAmount).toBe(0);
  });

  test("open fills use only the preceding day's liquidity, not future intraday volume", () => {
    const { bars, config } = fixture();
    config.execution!.price = "next_open";
    config.execution!.minimumCommission = 0;
    config.execution!.maxParticipationRate = 0.1;
    bars.find(b => b.symbol === "510001" && b.date === dates[32])!.amount = 100;
    const quote = bars.find(b => b.symbol === "510001" && b.date === dates[33])!;
    quote.amount = 0;
    quote.volume = 0;
    const result = runBacktest({ bars, profiles, config });
    expect(result.rebalances[0].holdings[0].weight).toBeCloseTo(0.001, 8);
  });

  test("an off-cycle ranking change does not create an actionable rotation target", () => {
    const { bars, config } = fixture();
    config.rebalance = { frequency: "interval", intervalDays: 5 };
    config.backtestEndDate = dates[35];
    setPrice(bars, "510001", 34, 90);
    setPrice(bars, "510002", 34, 110);
    setPrice(bars, "510002", 35, 132);
    const result = runBacktest({ bars, profiles, config });
    expect(result.latestSignal.rankings[0].symbol).toBe("510002");
    expect(result.latestSignal.holdings.map(h => h.symbol)).toEqual(["510001"]);
    expect(result.latestSignal.nextRebalanceHint).toContain("今日非轮动日");
  });
});
