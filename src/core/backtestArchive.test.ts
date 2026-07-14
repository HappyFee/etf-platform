import { describe, expect, test } from "vitest";
import { runBacktest } from "./backtest";
import {
  createBacktestSnapshot,
  isBacktestSnapshot,
  prependBacktestSnapshot,
  serializeSnapshotCsv,
  serializeSnapshotJson,
  snapshotFileStem
} from "./backtestArchive";
import { defaultStrategy } from "./defaultStrategy";
import { etfProfiles, marketBars } from "./sampleData";

function snapshot(id: string, createdAt = "2026-07-14T12:00:00.000Z") {
  return createBacktestSnapshot({
    id,
    createdAt,
    config: defaultStrategy,
    result: runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultStrategy
    }),
    dataSource: "test",
    dataLatestDate: marketBars.at(-1)!.date
  });
}

describe("backtest archive", () => {
  test("captures a versioned and immutable backtest snapshot", () => {
    const item = snapshot("snapshot-1");

    expect(item.version).toBe(1);
    expect(item.strategyName).toBe(defaultStrategy.name);
    expect(item.equityCurve.length).toBeGreaterThan(250);
    expect(item.metrics.totalReturn).toBeTypeOf("number");
    expect(item.config).not.toBe(defaultStrategy);
  });

  test("keeps newest snapshots first and enforces the configured limit", () => {
    const first = snapshot("snapshot-1");
    const second = snapshot("snapshot-2", "2026-07-14T13:00:00.000Z");
    const items = prependBacktestSnapshot([first], second, 1);

    expect(items.map((item) => item.id)).toEqual(["snapshot-2"]);
  });

  test("exports reproducible JSON and equity-curve CSV", () => {
    const item = snapshot("snapshot-1");
    const json = JSON.parse(serializeSnapshotJson(item));
    const csv = serializeSnapshotCsv(item);

    expect(json.id).toBe("snapshot-1");
    expect(csv).toContain("date,strategy_equity,benchmark_equity");
    expect(csv.split("\r\n")).toHaveLength(item.equityCurve.length + 1);
    expect(snapshotFileStem(item)).not.toMatch(/[\\/:*?"<>|]/);
  });

  test("rejects incomplete stored snapshots before rendering them", () => {
    expect(
      isBacktestSnapshot({
        version: 1,
        id: "incomplete",
        equityCurve: []
      })
    ).toBe(false);
  });
});
