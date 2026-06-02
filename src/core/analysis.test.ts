import { describe, expect, test } from "vitest";
import { buildDataQualityReport, buildRobustnessReport } from "./analysis";
import { defaultStrategy } from "./defaultStrategy";
import { etfProfiles, marketBars } from "./sampleData";

describe("strategy diagnostics", () => {
  test("summarizes data quality by ETF symbol", () => {
    const report = buildDataQualityReport(marketBars, etfProfiles);

    expect(report.symbolCount).toBe(etfProfiles.length);
    expect(report.latestDate).toBe(marketBars.at(-1)!.date);
    expect(report.symbols[0].coverageRatio).toBeGreaterThan(0.95);
    expect(report.symbols[0].averageAmount).toBeGreaterThan(0);
  });

  test("builds robustness cases for execution cost and factor windows", () => {
    const report = buildRobustnessReport({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultStrategy,
      strategyBook: [defaultStrategy]
    });

    expect(report.cases.length).toBeGreaterThanOrEqual(3);
    expect(report.cases.every((item) => Number.isFinite(item.totalReturn))).toBe(true);
    expect(report.summary.length).toBeGreaterThan(0);
  });
});
