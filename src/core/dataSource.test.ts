import { describe, expect, test } from "vitest";
import { generatedDatasetUrl, loadGeneratedDataset } from "./dataSource";
import { etfProfiles, marketBars } from "./sampleData";

describe("market data source", () => {
  test("builds generated data URL from the Vite base path", () => {
    expect(generatedDatasetUrl("/")).toBe("/data/a-share-etf-bars.generated.json");
    expect(generatedDatasetUrl("/etf-platform/")).toBe(
      "/etf-platform/data/a-share-etf-bars.generated.json"
    );
  });

  test("loads generated JSON when it has profiles and bars", async () => {
    const dataset = await loadGeneratedDataset(async () => {
      return {
        ok: true,
        json: async () => ({
          source: "unit-test",
          generatedAt: "2026-05-28T00:00:00Z",
          latestDate: "2026-05-29",
          requestedSymbols: ["510300", "159915"],
          succeededSymbols: ["510300"],
          failedSymbols: { "159915": "provider timeout" },
          profiles: etfProfiles.slice(0, 1),
          bars: marketBars.slice(0, 3)
        })
      } as Response;
    }, "/etf-platform/data/a-share-etf-bars.generated.json");

    expect(dataset?.source).toBe("unit-test");
    expect(dataset?.latestDate).toBe("2026-05-29");
    expect(dataset?.succeededSymbols).toEqual(["510300", "511880"]);
    expect(dataset?.failedSymbols).toEqual({ "159915": "provider timeout" });
    expect(dataset?.profiles).toHaveLength(2);
    expect(dataset?.bars).toHaveLength(6);
  });

  test("supplements the default cash replacement ETF when generated data omits it", async () => {
    const sourceBars = marketBars.filter((bar) => bar.symbol === "510300").slice(0, 2);

    const dataset = await loadGeneratedDataset(async () => {
      return {
        ok: true,
        json: async () => ({
          source: "unit-test",
          generatedAt: "2026-05-28T00:00:00Z",
          profiles: etfProfiles.filter((profile) => profile.symbol === "510300"),
          bars: sourceBars
        })
      } as Response;
    });

    expect(dataset?.profiles.some((profile) => profile.symbol === "511880")).toBe(true);
    expect(dataset?.bars.filter((bar) => bar.symbol === "511880")).toHaveLength(2);
    expect(dataset?.bars.find((bar) => bar.symbol === "511880")?.close).toBeGreaterThan(0);
  });

  test("returns null when the generated JSON file is missing", async () => {
    const dataset = await loadGeneratedDataset(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({})
      } as Response;
    });

    expect(dataset).toBeNull();
  });
});
