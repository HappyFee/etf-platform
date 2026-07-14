import { describe, expect, test } from "vitest";
import {
  buildDataQualityReport,
  buildRobustnessReport,
  buildValidationReport
} from "./analysis";
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

  test("splits the configured period into in-sample and out-of-sample validation", () => {
    const report = buildValidationReport({
      bars: marketBars,
      profiles: etfProfiles,
      config: defaultStrategy,
      strategyBook: [defaultStrategy]
    });

    expect(report.splitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.inSample!.endDate < report.outOfSample!.startDate).toBe(true);
    expect(["stable", "mixed", "weak"]).toContain(report.status);
    expect(report.checks.find((check) => check.label === "信号与成交分离")?.status)
      .toBe("pass");
    expect(report.checks.find((check) => check.label === "历史截断重放")?.status)
      .toBe("pass");
    expect(report.checks.some((check) => check.status === "warn")).toBe(true);
  });
});
