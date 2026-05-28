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
          profiles: etfProfiles.slice(0, 1),
          bars: marketBars.slice(0, 3)
        })
      } as Response;
    }, "/etf-platform/data/a-share-etf-bars.generated.json");

    expect(dataset?.source).toBe("unit-test");
    expect(dataset?.profiles).toHaveLength(1);
    expect(dataset?.bars).toHaveLength(3);
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
