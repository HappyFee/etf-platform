import { describe, expect, test } from "vitest";
import { evaluateUniverse, factorCatalog } from "./factors";
import { defaultStrategy } from "./defaultStrategy";
import { etfProfiles, groupBarsBySymbol, marketBars } from "./sampleData";

describe("factor engine", () => {
  test("uses one generic factor definition with different window parameters", () => {
    const grouped = groupBarsBySymbol(marketBars);
    const bars = grouped.get("510300")!;
    const evaluationDate = marketBars.at(-1)!.date;

    const shortMomentum = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        factors: [
          {
            key: "return-short",
            id: "return",
            enabled: true,
            weight: 1,
            direction: "desc",
            params: { window: 20 }
          }
        ]
      },
      date: evaluationDate
    });
    const longMomentum = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        factors: [
          {
            key: "return-long",
            id: "return",
            enabled: true,
            weight: 1,
            direction: "desc",
            params: { window: 120 }
          }
        ]
      },
      date: evaluationDate
    });

    const shortValue = shortMomentum.rows.find((row) => row.symbol === bars[0].symbol)!
      .factorScores["return-short"].raw;
    const longValue = longMomentum.rows.find((row) => row.symbol === bars[0].symbol)!
      .factorScores["return-long"].raw;

    expect(shortValue).not.toBe(longValue);
  });

  test("normalizes factor ranks by direction and combines weighted scores", () => {
    const grouped = groupBarsBySymbol(marketBars);
    const evaluationDate = marketBars.at(-1)!.date;

    const result = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        factors: [
          {
            key: "return-60",
            id: "return",
            enabled: true,
            weight: 0.7,
            direction: "desc",
            params: { window: 60 }
          },
          {
            key: "volatility-20",
            id: "volatility",
            enabled: true,
            weight: 0.3,
            direction: "asc",
            params: { window: 20 }
          }
        ]
      },
      date: evaluationDate
    });

    expect(result.rows.length).toBe(defaultStrategy.universe.length);
    expect(result.rows[0].score).toBeGreaterThanOrEqual(result.rows.at(-1)!.score);
    expect(result.rows[0].factorScores["return-60"].normalized).toBeGreaterThanOrEqual(
      0
    );
    expect(result.rows[0].factorScores["return-60"].normalized).toBeLessThanOrEqual(1);
  });

  test("applies filter rules before ranking candidates", () => {
    const grouped = groupBarsBySymbol(marketBars);
    const evaluationDate = marketBars.at(-1)!.date;
    const activeAmountFactor = factorCatalog.find((factor) => factor.id === "amount_ma");

    expect(activeAmountFactor).toBeDefined();

    const result = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        filters: [
          {
            factorId: "amount_ma",
            operator: ">=",
            value: 200_000_000,
            params: { window: 20 }
          }
        ]
      },
      date: evaluationDate
    });

    expect(result.rows.length).toBeLessThanOrEqual(defaultStrategy.universe.length);
    expect(result.rows.every((row) => row.passesFilters)).toBe(true);
  });

  test("applies between filter rules before ranking candidates", () => {
    const grouped = groupBarsBySymbol(marketBars);
    const evaluationDate = marketBars.at(-1)!.date;

    const looseResult = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        filters: [
          {
            factorId: "volatility",
            operator: "between",
            value: 0,
            value2: 10,
            params: { window: 20 }
          }
        ]
      },
      date: evaluationDate
    });
    const strictResult = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        filters: [
          {
            factorId: "volatility",
            operator: "between",
            value: 0,
            value2: 0.000001,
            params: { window: 20 }
          }
        ]
      },
      date: evaluationDate
    });

    expect(looseResult.rows.length).toBeGreaterThan(0);
    expect(strictResult.rows).toEqual([]);
  });

  test("does not rank ETFs when no enabled factor can score the universe", () => {
    const grouped = groupBarsBySymbol(marketBars);
    const evaluationDate = marketBars.at(-1)!.date;

    const result = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        factors: defaultStrategy.factors.map((factor) => ({
          ...factor,
          enabled: false
        }))
      },
      date: evaluationDate
    });

    expect(result.rows).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("因子"))).toBe(true);
  });
});
