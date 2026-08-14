import type {
  DynamicUniverseConfig,
  EtfProfile,
  MarketBar,
  UniverseMembershipSnapshot,
  UniverseRejectionReason,
  UniverseSelectionMember,
  UniverseSelectionRecord
} from "./types";

export const defaultDynamicUniverseConfig: DynamicUniverseConfig = {
  mode: "dynamic",
  minimumHistoryDays: 120,
  coverageLookbackDays: 120,
  minimumCoverageRatio: 0.95,
  liquidityLookbackDays: 20,
  minimumMedianAmount: 50_000_000,
  maximumSymbols: 24,
  maximumPerCategory: 3,
  retentionBufferRatio: 0.3,
  excludedCategories: ["货币"]
};

interface Candidate extends UniverseSelectionMember {
  exposureKey: string;
}

interface SelectDynamicUniverseInput {
  date: string;
  dates: string[];
  barsBySymbol: Map<string, MarketBar[]>;
  profiles: EtfProfile[];
  config: DynamicUniverseConfig;
  previous?: UniverseSelectionRecord;
  membershipSnapshots?: UniverseMembershipSnapshot[];
}

interface AvailableSymbols {
  symbols: Set<string>;
  usedFallback: boolean;
}

const unsupportedProductPattern = /(?:杠杆|反向|两倍|2倍|三倍|3倍|分级|REIT|LOF)/i;

function normalizedConfig(config: DynamicUniverseConfig): DynamicUniverseConfig {
  return {
    ...defaultDynamicUniverseConfig,
    ...config,
    minimumHistoryDays: Math.max(1, Math.round(config.minimumHistoryDays)),
    coverageLookbackDays: Math.max(1, Math.round(config.coverageLookbackDays)),
    minimumCoverageRatio: Math.min(1, Math.max(0, config.minimumCoverageRatio)),
    liquidityLookbackDays: Math.max(1, Math.round(config.liquidityLookbackDays)),
    minimumMedianAmount: Math.max(0, config.minimumMedianAmount),
    maximumSymbols: Math.max(1, Math.round(config.maximumSymbols)),
    maximumPerCategory: Math.max(1, Math.round(config.maximumPerCategory)),
    retentionBufferRatio: Math.max(0, config.retentionBufferRatio),
    excludedCategories: config.excludedCategories ?? []
  };
}

export function isDynamicUniverse(config?: DynamicUniverseConfig): boolean {
  return config?.mode === "dynamic";
}

export function sameSelectionMonth(left: string, right: string): boolean {
  return left.slice(0, 7) === right.slice(0, 7);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function increment(
  counts: Partial<Record<UniverseRejectionReason, number>>,
  reason: UniverseRejectionReason
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function exposureKey(profile: EtfProfile): string {
  const trackingIndex = profile.trackingIndex.trim().toLowerCase();
  if (trackingIndex && trackingIndex !== profile.symbol.toLowerCase()) {
    return trackingIndex.replace(/[\s·()（）_-]+/g, "");
  }
  return `${profile.category}:${profile.name}`.toLowerCase().replace(/[\s·()（）_-]+/g, "");
}

function availableSymbolsAt(
  date: string,
  profiles: EtfProfile[],
  snapshots: UniverseMembershipSnapshot[] = []
): AvailableSymbols {
  const snapshot = [...snapshots]
    .filter((item) => item.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))[0];

  if (snapshot) {
    return { symbols: new Set(snapshot.symbols), usedFallback: false };
  }

  return {
    symbols: new Set(profiles.map((profile) => profile.symbol)),
    usedFallback: true
  };
}

function betterCandidate(left: Candidate, right: Candidate): number {
  if (left.medianAmount !== right.medianAmount) {
    return right.medianAmount - left.medianAmount;
  }
  if (left.expenseRatio !== right.expenseRatio) {
    return left.expenseRatio - right.expenseRatio;
  }
  return left.symbol.localeCompare(right.symbol);
}

function chooseExposureRepresentative(
  candidates: Candidate[],
  previousSymbols: Set<string>,
  retentionBufferRatio: number
): Candidate {
  const ordered = [...candidates].sort(betterCandidate);
  const challenger = ordered[0];
  const incumbent = ordered
    .filter((candidate) => previousSymbols.has(candidate.symbol))
    .sort(betterCandidate)[0];

  if (
    incumbent &&
    challenger.symbol !== incumbent.symbol &&
    challenger.medianAmount < incumbent.medianAmount * (1 + retentionBufferRatio)
  ) {
    return incumbent;
  }

  return challenger;
}

function selectedReason(
  candidate: Candidate,
  exposureSize: number,
  previousSymbols: Set<string>
): string {
  if (previousSymbols.has(candidate.symbol)) {
    return "延续上期，交易资格仍达标";
  }
  if (exposureSize > 1) {
    return "同类跟踪标的中流动性更优";
  }
  return "历史、完整性和流动性均达标";
}

export function selectDynamicUniverse({
  date,
  dates,
  barsBySymbol,
  profiles,
  config: requestedConfig,
  previous,
  membershipSnapshots
}: SelectDynamicUniverseInput): UniverseSelectionRecord {
  const config = normalizedConfig(requestedConfig);
  const previousSymbols = new Set(previous?.selected.map((item) => item.symbol) ?? []);
  const available = availableSymbolsAt(date, profiles, membershipSnapshots);
  const datesThroughSignal = dates.filter((item) => item <= date);
  const coverageDates = new Set(datesThroughSignal.slice(-config.coverageLookbackDays));
  const liquidityDates = new Set(datesThroughSignal.slice(-config.liquidityLookbackDays));
  const excludedCategories = new Set(
    config.excludedCategories.map((category) => category.trim().toLowerCase())
  );
  const rejectedCounts: Partial<Record<UniverseRejectionReason, number>> = {};
  const eligible: Candidate[] = [];

  for (const profile of profiles) {
    if (!available.symbols.has(profile.symbol)) {
      continue;
    }
    if (excludedCategories.has(profile.category.trim().toLowerCase())) {
      increment(rejectedCounts, "excluded-category");
      continue;
    }
    if (unsupportedProductPattern.test(`${profile.name} ${profile.category}`)) {
      increment(rejectedCounts, "unsupported-product");
      continue;
    }

    const history = (barsBySymbol.get(profile.symbol) ?? []).filter((bar) => bar.date <= date);
    if (history.length < config.minimumHistoryDays) {
      increment(rejectedCounts, "insufficient-history");
      continue;
    }

    const coveredDays = history.filter((bar) => coverageDates.has(bar.date)).length;
    const coverageRatio = coveredDays / Math.max(1, coverageDates.size);
    if (coverageRatio < config.minimumCoverageRatio) {
      increment(rejectedCounts, "insufficient-coverage");
      continue;
    }

    const medianAmount = median(
      history
        .filter((bar) => liquidityDates.has(bar.date) && bar.amount > 0)
        .map((bar) => bar.amount)
    );
    if (medianAmount < config.minimumMedianAmount) {
      increment(rejectedCounts, "insufficient-liquidity");
      continue;
    }

    eligible.push({
      symbol: profile.symbol,
      name: profile.name,
      category: profile.category || "其他",
      trackingIndex: profile.trackingIndex || profile.name,
      historyDays: history.length,
      coverageRatio,
      medianAmount,
      expenseRatio: profile.expenseRatio,
      retained: previousSymbols.has(profile.symbol),
      reason: "",
      exposureKey: exposureKey(profile)
    });
  }

  const byExposure = new Map<string, Candidate[]>();
  for (const candidate of eligible) {
    const group = byExposure.get(candidate.exposureKey) ?? [];
    group.push(candidate);
    byExposure.set(candidate.exposureKey, group);
  }

  const representatives = [...byExposure.values()].map((group) => {
    const selected = chooseExposureRepresentative(
      group,
      previousSymbols,
      config.retentionBufferRatio
    );
    rejectedCounts["duplicate-exposure"] =
      (rejectedCounts["duplicate-exposure"] ?? 0) + Math.max(0, group.length - 1);
    return {
      ...selected,
      reason: selectedReason(selected, group.length, previousSymbols)
    };
  });

  representatives.sort((left, right) => {
    const leftScore = left.medianAmount * (previousSymbols.has(left.symbol) ? 1 + config.retentionBufferRatio : 1);
    const rightScore = right.medianAmount * (previousSymbols.has(right.symbol) ? 1 + config.retentionBufferRatio : 1);
    return rightScore - leftScore || betterCandidate(left, right);
  });

  const categoryCounts = new Map<string, number>();
  const selected: UniverseSelectionMember[] = [];
  for (const candidate of representatives) {
    if (selected.length >= config.maximumSymbols) {
      increment(rejectedCounts, "universe-cap");
      continue;
    }
    const categoryCount = categoryCounts.get(candidate.category) ?? 0;
    if (categoryCount >= config.maximumPerCategory) {
      increment(rejectedCounts, "category-cap");
      continue;
    }
    categoryCounts.set(candidate.category, categoryCount + 1);
    const { exposureKey: _exposureKey, ...member } = candidate;
    selected.push(member);
  }

  const selectedSymbols = new Set(selected.map((item) => item.symbol));
  return {
    date,
    selected,
    added: selected.filter((item) => !previousSymbols.has(item.symbol)).map((item) => item.symbol),
    removed: [...previousSymbols].filter((symbol) => !selectedSymbols.has(symbol)),
    eligibleCount: eligible.length,
    rejectedCounts,
    usedHistoricalMembershipFallback: available.usedFallback
  };
}
