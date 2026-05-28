import { describe, expect, test } from "vitest";
import { evaluateUniverse, factorCatalog } from "./factors";
import { defaultStrategy } from "./defaultStrategy";
import { etfProfiles, groupBarsBySymbol, marketBars } from "./sampleData";

describe("factor engine", () => {
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
            id: "return_60d",
            enabled: true,
            weight: 0.7,
            direction: "desc",
            params: { window: 60 }
          },
          {
            id: "volatility_20d",
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
    expect(result.rows[0].factorScores.return_60d.normalized).toBeGreaterThanOrEqual(
      0
    );
    expect(result.rows[0].factorScores.return_60d.normalized).toBeLessThanOrEqual(1);
  });

  test("applies filter rules before ranking candidates", () => {
    const grouped = groupBarsBySymbol(marketBars);
    const evaluationDate = marketBars.at(-1)!.date;
    const activeAmountFactor = factorCatalog.find((factor) => factor.id === "amount_ma20");

    expect(activeAmountFactor).toBeDefined();

    const result = evaluateUniverse({
      barsBySymbol: grouped,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        filters: [
          {
            factorId: "amount_ma20",
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
