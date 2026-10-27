import { describe, expect, test } from "vitest";
import { defaultRotationRules, selectRotationRows } from "./rotation";
import type { EvaluationRow, Holding, RotationRules } from "./types";

function row(symbol: string, periodReturn: number): EvaluationRow {
  return { symbol, periodReturn, name: symbol, category: "ETF", score: 1,
    passesFilters: true, factorScores: {}, filterValues: {} };
}
const rows = [row("A", 0.2), row("B", 0.1), row("C", 0.03), row("D", -0.1)];
const holdings = (...symbols: string[]): Holding[] => symbols.map(symbol => ({ symbol, name: symbol, weight: 0.3 }));
const rules = (patch: Partial<RotationRules> = {}): RotationRules => ({ ...defaultRotationRules, ...patch });

describe("return rotation trading rules", () => {
  test("sell conditions veto a conflicting buy for both existing and new positions", () => {
    const conflicting = rules({ buy: { rankFrom: 1, rankTo: 1, minReturn: 0.1, maxNewPositions: 1 },
      sell: { returnAbove: 0.15, match: "any" } });
    expect(selectRotationRows(rows, [], conflicting, 1)).toEqual([]);
    expect(selectRotationRows(rows, holdings("A"), conflicting, 1)).toEqual([]);
  });

  test("a retained ETF is not counted as a new buy or duplicated", () => {
    const result = selectRotationRows(rows, holdings("A", "A"), rules({
      buy: { rankFrom: 1, rankTo: 3, maxNewPositions: 1 }, sell: { match: "all" }
    }), 3);
    expect(result.map(r => r.symbol)).toEqual(["A", "B"]);
  });

  test.each([
    [0.3, 0.3, 0.3, true],
    [130 / 100 - 1, 0.3, 0.3, true],
    [110 / 100 - 1, 0.1, 0.1, true],
    [0.299, 0.3, 0.4, false],
    [0.401, 0.3, 0.4, false]
  ])("handles inclusive buy return boundaries %s in [%s, %s]", (value, min, max, expected) => {
    expect(selectRotationRows([row("A", value as number)], [], rules({
      buy: { rankFrom: 1, rankTo: 1, minReturn: min as number, maxReturn: max as number, maxNewPositions: 1 },
      sell: { match: "any" }
    }), 1).length > 0).toBe(expected);
  });

  test("sell return boundaries are strict, tolerate floating point equality, and ignore blank conditions", () => {
    const buy = { rankFrom: 1, rankTo: 4, maxNewPositions: 0 };
    expect(selectRotationRows([row("A", 130 / 100 - 1)], holdings("A"), rules({
      buy, sell: { returnAbove: 0.3, match: "any" }
    }), 1).map(r => r.symbol)).toEqual(["A"]);
    expect(selectRotationRows([row("A", 110 / 100 - 1)], holdings("A"), rules({
      buy, sell: { returnBelow: 0.1, match: "all" }
    }), 1).map(r => r.symbol)).toEqual(["A"]);
    expect(selectRotationRows(rows, holdings("B"), rules({ buy, sell: { rankBelow: 2, match: "any" } }), 1)
      .map(r => r.symbol)).toEqual(["B"]);
    expect(selectRotationRows(rows, holdings("D"), rules({ buy, sell: { match: "all" } }), 1)
      .map(r => r.symbol)).toEqual(["D"]);
  });

  test("excludes replacement assets and invalid values before counting buy ranks", () => {
    const values = [row("cash", 0.5), row("bad", NaN), row("A", 0.2), row("A", 0.2)];
    expect(selectRotationRows(values, [], rules({
      buy: { rankFrom: 1, rankTo: 1, maxNewPositions: 2 }, sell: { match: "any" }
    }), 2, "cash").map(r => r.symbol)).toEqual(["A"]);
  });

  test("invalid limits and inverted bounds never turn into unlimited buying", () => {
    for (const buy of [
      { ...defaultRotationRules.buy, maxNewPositions: NaN },
      { ...defaultRotationRules.buy, rankFrom: NaN },
      { ...defaultRotationRules.buy, rankFrom: 3, rankTo: 1 },
      { ...defaultRotationRules.buy, minReturn: 0.3, maxReturn: 0.1 },
      { ...defaultRotationRules.buy, minReturn: NaN }
    ]) expect(selectRotationRows(rows, [], rules({ buy }), 3)).toEqual([]);
    expect(selectRotationRows(rows, [], rules(), NaN)).toEqual([]);
  });
  test("combines inclusive buy rank and return bounds with a new-buy limit", () => {
    const result = selectRotationRows(rows, [], rules({ buy: {
      rankFrom: 2, rankTo: 4, minReturn: 0.03, maxReturn: 0.1, maxNewPositions: 1
    } }), 3);
    expect(result.map(r => r.symbol)).toEqual(["B"]);
  });

  test("keeps an incumbent outside buy ranks until its sell condition fires", () => {
    const result = selectRotationRows(rows, holdings("C"), rules({
      buy: { rankFrom: 1, rankTo: 1, maxNewPositions: 1 }, sell: { rankBelow: 3, match: "any" }
    }), 2);
    expect(result.map(r => r.symbol)).toEqual(["A", "C"]);
  });

  test("supports any/all sell conditions and never rebuys a sold ETF in the same cycle", () => {
    const sell = { rankBelow: 2, returnBelow: 0, match: "any" as const };
    const buy = { rankFrom: 1, rankTo: 4, maxNewPositions: 0 };
    expect(selectRotationRows(rows, holdings("C"), rules({ buy, sell }), 3)).toEqual([]);
    expect(selectRotationRows(rows, holdings("C"), rules({ buy, sell: { ...sell, match: "all" } }), 3)
      .map(r => r.symbol)).toEqual(["C"]);
    expect(selectRotationRows(rows, holdings("A"), rules({
      buy: { rankFrom: 1, rankTo: 4, maxNewPositions: 1 },
      sell: { returnAbove: 0.15, match: "any" }
    }), 1).map(r => r.symbol)).toEqual(["B"]);
  });

  test("enforces capacity, removes ineligible holdings, and excludes the replacement asset", () => {
    expect(selectRotationRows(rows, holdings("B", "C", "missing", "cash"),
      rules({ sell: { match: "any" } }), 1, "cash").map(r => r.symbol)).toEqual(["B"]);
    expect(selectRotationRows(rows, [], rules(), 0)).toEqual([]);
  });
});
