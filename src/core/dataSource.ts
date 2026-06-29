import { etfProfiles, marketBars } from "./sampleData";
import { defaultCashReplacementSymbol } from "./defaultStrategy";
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

function uniqueSortedDates(bars: MarketBar[]): string[] {
  return [...new Set(bars.map((bar) => bar.date))].sort();
}

function replacementProfile(): EtfProfile {
  return (
    etfProfiles.find((profile) => profile.symbol === defaultCashReplacementSymbol) ?? {
      symbol: defaultCashReplacementSymbol,
      name: "银华日利ETF",
      exchange: "SH",
      category: "货币",
      trackingIndex: "货币市场",
      expenseRatio: 0.003
    }
  );
}

function replacementBarsForDates(dates: string[]): MarketBar[] {
  const fallbackBars = new Map(
    marketBars
      .filter((bar) => bar.symbol === defaultCashReplacementSymbol)
      .map((bar) => [bar.date, bar])
  );
  let close = fallbackBars.values().next().value?.close ?? 100;

  return dates.map((date) => {
    const fallback = fallbackBars.get(date);
    if (fallback) {
      close = fallback.close;
      return fallback;
    }

    const open = close;
    close = Number((close * (1 + 0.00006)).toFixed(4));
    const amount = 1_400_000_000;
    return {
      symbol: defaultCashReplacementSymbol,
      date,
      open: Number(open.toFixed(4)),
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: Math.round(amount / close / 100),
      amount
    };
  });
}

function supplementCashReplacement(
  profiles: EtfProfile[],
  bars: MarketBar[],
  succeededSymbols?: string[]
): {
  profiles: EtfProfile[];
  bars: MarketBar[];
  succeededSymbols?: string[];
} {
  const hasProfile = profiles.some((profile) => profile.symbol === defaultCashReplacementSymbol);
  const hasBars = bars.some((bar) => bar.symbol === defaultCashReplacementSymbol);

  if (hasProfile && hasBars) {
    return { profiles, bars, succeededSymbols };
  }

  const nextProfiles = hasProfile ? profiles : [...profiles, replacementProfile()];
  const nextBars = hasBars
    ? bars
    : [...bars, ...replacementBarsForDates(uniqueSortedDates(bars))];
  const nextSucceededSymbols =
    succeededSymbols && !succeededSymbols.includes(defaultCashReplacementSymbol)
      ? [...succeededSymbols, defaultCashReplacementSymbol]
      : succeededSymbols;

  return {
    profiles: nextProfiles,
    bars: nextBars,
    succeededSymbols: nextSucceededSymbols
  };
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

    const parsedProfiles = payload.profiles.filter(isProfile);
    const parsedBars = payload.bars.filter(isMarketBar);

    if (parsedProfiles.length === 0 || parsedBars.length === 0) {
      return null;
    }

    const succeededSymbols = stringArray(payload.succeededSymbols);
    const { profiles, bars, succeededSymbols: supplementedSucceededSymbols } =
      supplementCashReplacement(parsedProfiles, parsedBars, succeededSymbols);

    return {
      source: typeof payload.source === "string" ? payload.source : "generated",
      generatedAt:
        typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
      latestDate: typeof payload.latestDate === "string" ? payload.latestDate : undefined,
      requestedSymbols: stringArray(payload.requestedSymbols),
      succeededSymbols: supplementedSucceededSymbols,
      failedSymbols: stringRecord(payload.failedSymbols),
      profiles,
      bars
    };
  } catch {
    return null;
  }
}
