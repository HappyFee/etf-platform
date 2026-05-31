import { describe, expect, test } from "vitest";
import { nextRebalanceHint, shouldRebalance } from "./date";

describe("rebalance schedule", () => {
  test("rebalances weekly on the selected weekday", () => {
    const dates = ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"];

    const flags = dates.map((_, index) =>
      shouldRebalance(dates, index, { frequency: "weekly", weeklyDay: 3 }, true)
    );

    expect(flags).toEqual([false, false, true, false, false]);
  });

  test("moves weekly rebalance to the next trading day in the same week when the target day is missing", () => {
    const dates = ["2026-05-18", "2026-05-19", "2026-05-21", "2026-05-22"];

    const flags = dates.map((_, index) =>
      shouldRebalance(dates, index, { frequency: "weekly", weeklyDay: 3 }, true)
    );

    expect(flags).toEqual([false, false, true, false]);
  });

  test("moves monthly rebalance to the last trading day when the target day is after month end", () => {
    const dates = ["2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27"];

    const flags = dates.map((_, index) =>
      shouldRebalance(dates, index, { frequency: "monthly", monthlyDay: 31 }, true)
    );

    expect(flags).toEqual([false, false, false, true]);
  });

  test("describes configured rebalance timing for tracking", () => {
    expect(nextRebalanceHint({ frequency: "weekly", weeklyDay: 5 })).toContain("周五");
    expect(nextRebalanceHint({ frequency: "monthly", monthlyDay: 15 })).toContain("15");
  });
});
