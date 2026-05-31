import { etfProfiles, marketBars } from "./sampleData";
import type { EtfProfile, MarketBar } from "./types";

export interface MarketDataset {
  source: string;
  generatedAt: string;
  latestDate?: string;
  requestedSymbols?: string[];
  succeededSymbols?: string[];
  failedSymbols?: Record<string, string>;
  profiles: EtfProfile[];
  bars: MarketBar[];
}

interface GeneratedPayload {
  source?: unknown;
  generatedAt?: unknown;
  latestDate?: unknown;
  requestedSymbols?: unknown;
  succeededSymbols?: unknown;
  failedSymbols?: unknown;
  profiles?: unknown;
  bars?: unknown;
}

export const sampleDataset: MarketDataset = {
  source: "demo.generated",
  generatedAt: "2026-05-22T00:00:00Z",
  latestDate: "2026-05-22",
  requestedSymbols: etfProfiles.map((profile) => profile.symbol),
  succeededSymbols: etfProfiles.map((profile) => profile.symbol),
  failedSymbols: {},
  profiles: etfProfiles,
  bars: marketBars
};

export function generatedDatasetUrl(baseUrl = "/"): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}data/a-share-etf-bars.generated.json`;
}

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

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string");
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string"
    )
  );
}

export async function loadGeneratedDataset(
  fetcher: typeof fetch = fetch,
  url = generatedDatasetUrl()
): Promise<MarketDataset | null> {
  try {
    const response = await fetcher(url, {
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
      latestDate: typeof payload.latestDate === "string" ? payload.latestDate : undefined,
      requestedSymbols: stringArray(payload.requestedSymbols),
      succeededSymbols: stringArray(payload.succeededSymbols),
      failedSymbols: stringRecord(payload.failedSymbols),
      profiles,
      bars
    };
  } catch {
    return null;
  }
}
