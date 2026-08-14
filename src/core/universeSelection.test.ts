import { describe, expect, test } from "vitest";
import type {
  DynamicUniverseConfig,
  EtfProfile,
  MarketBar,
  UniverseMembershipSnapshot,
  UniverseSelectionRecord
} from "./types";
import {
  defaultDynamicUniverseConfig,
  selectDynamicUniverse
} from "./universeSelection";

const dates = [
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
  "2026-01-12"
];

function profile(
  symbol: string,
  trackingIndex = symbol,
  category = "行业"
): EtfProfile {
  return {
    symbol,
    name: `${symbol} ETF`,
    exchange: symbol.startsWith("5") ? "SH" : "SZ",
    category,
    trackingIndex,
    expenseRatio: 0.005
  };
}

function bars(symbol: string, amounts: number[], selectedDates = dates): MarketBar[] {
  return amounts.map((amount, index) => ({
    symbol,
    date: selectedDates[index],
    open: 1 + index * 0.01,
    high: 1.02 + index * 0.01,
    low: 0.99 + index * 0.01,
    close: 1.01 + index * 0.01,
    volume: Math.round(amount / 1.01),
    amount
  }));
}

function config(patch: Partial<DynamicUniverseConfig> = {}): DynamicUniverseConfig {
  return {
    ...defaultDynamicUniverseConfig,
    minimumHistoryDays: 4,
    coverageLookbackDays: 4,
    liquidityLookbackDays: 3,
    minimumMedianAmount: 50,
    maximumSymbols: 10,
    maximumPerCategory: 10,
    excludedCategories: ["货币"],
    ...patch
  };
}

function run({
  profiles,
  marketBars,
  requestedConfig = config(),
  date = "2026-01-09",
  previous,
  membershipSnapshots
}: {
  profiles: EtfProfile[];
  marketBars: MarketBar[];
  requestedConfig?: DynamicUniverseConfig;
  date?: string;
  previous?: UniverseSelectionRecord;
  membershipSnapshots?: UniverseMembershipSnapshot[];
}) {
  const barsBySymbol = new Map<string, MarketBar[]>();
  for (const bar of marketBars) {
    const values = barsBySymbol.get(bar.symbol) ?? [];
    values.push(bar);
    barsBySymbol.set(bar.symbol, values);
  }
  return selectDynamicUniverse({
    date,
    dates,
    barsBySymbol,
    profiles,
    config: requestedConfig,
    previous,
    membershipSnapshots
  });
}

describe("dynamic universe selection", () => {
  test("uses only bars available on the selection date", () => {
    const result = run({
      profiles: [profile("510001")],
      marketBars: bars("510001", [10, 10, 10, 10, 1_000, 1_000]),
      date: "2026-01-08"
    });

    expect(result.selected).toHaveLength(0);
    expect(result.rejectedCounts["insufficient-liquidity"]).toBe(1);
  });

  test("filters excluded categories, short histories, gaps and low liquidity", () => {
    const profiles = [
      profile("510001"),
      profile("510002", "债券", "货币"),
      profile("510003"),
      profile("510004"),
      profile("510005")
    ];
    const result = run({
      profiles,
      marketBars: [
        ...bars("510001", [100, 100, 100, 100, 100]),
        ...bars("510002", [100, 100, 100, 100, 100]),
        ...bars("510003", [100, 100, 100], dates.slice(0, 3)),
        ...bars("510004", [100, 100, 100, 100], [dates[0], dates[1], dates[2], dates[4]]),
        ...bars("510005", [10, 10, 10, 10, 10])
      ],
      requestedConfig: config({ minimumCoverageRatio: 1 })
    });

    expect(result.selected.map((item) => item.symbol)).toEqual(["510001"]);
    expect(result.rejectedCounts).toMatchObject({
      "excluded-category": 1,
      "insufficient-history": 1,
      "insufficient-coverage": 1,
      "insufficient-liquidity": 1
    });
  });

  test("keeps the same-index incumbent until the challenger clears the buffer", () => {
    const profiles = [profile("510001", "沪深300"), profile("510002", "沪深300")];
    const first = run({
      profiles,
      marketBars: [
        ...bars("510001", [100, 100, 100, 100, 100]),
        ...bars("510002", [80, 80, 80, 80, 80])
      ]
    });
    const retained = run({
      profiles,
      previous: first,
      marketBars: [
        ...bars("510001", [100, 100, 100, 100, 100]),
        ...bars("510002", [120, 120, 120, 120, 120])
      ]
    });
    const replaced = run({
      profiles,
      previous: first,
      marketBars: [
        ...bars("510001", [100, 100, 100, 100, 100]),
        ...bars("510002", [140, 140, 140, 140, 140])
      ]
    });

    expect(first.selected[0].symbol).toBe("510001");
    expect(retained.selected[0].symbol).toBe("510001");
    expect(retained.selected[0].retained).toBe(true);
    expect(replaced.selected[0].symbol).toBe("510002");
    expect(replaced.added).toEqual(["510002"]);
    expect(replaced.removed).toEqual(["510001"]);
  });

  test("applies category and total pool caps after exposure deduplication", () => {
    const profiles = [
      profile("510001", "指数1", "行业"),
      profile("510002", "指数2", "行业"),
      profile("510003", "指数3", "宽基"),
      profile("510004", "指数4", "商品")
    ];
    const marketBars = profiles.flatMap((item, index) =>
      bars(item.symbol, Array(5).fill(200 - index * 10))
    );
    const result = run({
      profiles,
      marketBars,
      requestedConfig: config({ maximumPerCategory: 1, maximumSymbols: 2 })
    });

    expect(result.selected.map((item) => item.symbol)).toEqual(["510001", "510003"]);
    expect(result.rejectedCounts["category-cap"]).toBe(1);
    expect(result.rejectedCounts["universe-cap"]).toBe(1);
  });

  test("uses the latest membership snapshot known on each selection date", () => {
    const profiles = [profile("510001"), profile("510002")];
    const marketBars = profiles.flatMap((item) =>
      bars(item.symbol, [100, 100, 100, 100, 100])
    );
    const membershipSnapshots = [
      { date: "2026-01-06", symbols: ["510001"] },
      { date: "2026-01-09", symbols: ["510002"] }
    ];

    const beforeSnapshots = run({
      profiles,
      marketBars,
      date: "2026-01-05",
      membershipSnapshots
    });
    const firstMembership = run({
      profiles,
      marketBars,
      date: "2026-01-08",
      membershipSnapshots
    });
    const secondMembership = run({
      profiles,
      marketBars,
      date: "2026-01-09",
      membershipSnapshots
    });

    expect(beforeSnapshots.usedHistoricalMembershipFallback).toBe(true);
    expect(firstMembership.selected.map((item) => item.symbol)).toEqual(["510001"]);
    expect(firstMembership.usedHistoricalMembershipFallback).toBe(false);
    expect(secondMembership.selected.map((item) => item.symbol)).toEqual(["510002"]);
  });
});
