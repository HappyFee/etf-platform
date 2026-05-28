import { describe, expect, test } from "vitest";
import { etfProfiles, groupBarsBySymbol, marketBars } from "./sampleData";

describe("sample ETF data", () => {
  test("ships a broad A-share ETF universe with sorted daily bars", () => {
    expect(etfProfiles.length).toBeGreaterThanOrEqual(10);

    const grouped = groupBarsBySymbol(marketBars);

    for (const profile of etfProfiles) {
      const bars = grouped.get(profile.symbol);

      expect(bars, `${profile.symbol} bars`).toBeDefined();
      expect(bars!.length, `${profile.symbol} history length`).toBeGreaterThan(
        400
      );

      for (let index = 1; index < bars!.length; index += 1) {
        expect(bars![index].date > bars![index - 1].date).toBe(true);
      }

      const latest = bars!.at(-1)!;
      expect(latest.close).toBeGreaterThan(0);
      expect(latest.amount).toBeGreaterThan(0);
    }
  });
});
