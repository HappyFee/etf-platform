import { etfProfiles, marketBars } from "./sampleData";
import type { EtfProfile, MarketBar } from "./types";

export interface MarketDataset {
  source: string;
  generatedAt: string;
  profiles: EtfProfile[];
  bars: MarketBar[];
}

interface GeneratedPayload {
  source?: unknown;
  generatedAt?: unknown;
  profiles?: unknown;
  bars?: unknown;
}

export const sampleDataset: MarketDataset = {
  source: "demo.generated",
  generatedAt: "2026-05-22T00:00:00Z",
  profiles: etfProfiles,
  bars: marketBars
};

function isProfile(value: unknown): value is EtfProfile {
  const item = value as Partial<EtfProfile>;
  return (
    typeof item?.symbol === "string" &&
    typeof item.name === "string" &&
    (item.exchange === "SH" || item.exchange === "SZ") &&
    typeof item.category === "string" &&
    typeof item.trackingIndex === "string" &&
    typeof item.expenseRatio === "number"
  );
}

function isMarketBar(value: unknown): value is MarketBar {
  const item = value as Partial<MarketBar>;
  return (
    typeof item?.symbol === "string" &&
    typeof item.date === "string" &&
    typeof item.open === "number" &&
    typeof item.high === "number" &&
    typeof item.low === "number" &&
    typeof item.close === "number" &&
    typeof item.volume === "number" &&
    typeof item.amount === "number"
  );
}

export async function loadGeneratedDataset(
  fetcher: typeof fetch = fetch
): Promise<MarketDataset | null> {
  try {
    const response = await fetcher("/data/a-share-etf-bars.generated.json", {
      cache: "no-cache"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GeneratedPayload;
    if (!Array.isArray(payload.profiles) || !Array.isArray(payload.bars)) {
      return null;
    }

    const profiles = payload.profiles.filter(isProfile);
    const bars = payload.bars.filter(isMarketBar);

    if (profiles.length === 0 || bars.length === 0) {
      return null;
    }

    return {
      source: typeof payload.source === "string" ? payload.source : "generated",
      generatedAt:
        typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
      profiles,
      bars
    };
  } catch {
    return null;
  }
}
