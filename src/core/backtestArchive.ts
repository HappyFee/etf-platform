import type {
  BacktestResult,
  BacktestSnapshot,
  StrategyConfig
} from "./types";

export const maxBacktestSnapshots = 12;

function cloneStrategy<T extends StrategyConfig>(strategy: T): T {
  return JSON.parse(JSON.stringify(strategy)) as T;
}

export function isBacktestSnapshot(value: unknown): value is BacktestSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Partial<BacktestSnapshot>;
  const config = snapshot.config as Partial<StrategyConfig> | undefined;
  const metrics = snapshot.metrics;
  return (
    snapshot.version === 1 &&
    typeof snapshot.id === "string" &&
    typeof snapshot.strategyId === "string" &&
    typeof snapshot.strategyName === "string" &&
    typeof snapshot.createdAt === "string" &&
    typeof snapshot.dataSource === "string" &&
    typeof snapshot.dataLatestDate === "string" &&
    typeof config?.id === "string" &&
    typeof config.name === "string" &&
    (config.kind === "base" || config.kind === "composite") &&
    metrics !== undefined &&
    typeof metrics.totalReturn === "number" &&
    typeof metrics.annualizedReturn === "number" &&
    typeof metrics.maxDrawdown === "number" &&
    typeof metrics.sharpe === "number" &&
    Array.isArray(snapshot.equityCurve) &&
    snapshot.equityCurve.every(
      (point) =>
        typeof point?.date === "string" &&
        typeof point.equity === "number" &&
        typeof point.dailyReturn === "number" &&
        typeof point.drawdown === "number"
    ) &&
    Array.isArray(snapshot.warnings) &&
    snapshot.warnings.every((warning) => typeof warning === "string")
  );
}

export function isBacktestSnapshotList(value: unknown): value is BacktestSnapshot[] {
  return Array.isArray(value) && value.every(isBacktestSnapshot);
}

export function createBacktestSnapshot({
  id,
  createdAt,
  config,
  result,
  dataSource,
  dataLatestDate
}: {
  id: string;
  createdAt: string;
  config: StrategyConfig;
  result: BacktestResult;
  dataSource: string;
  dataLatestDate: string;
}): BacktestSnapshot {
  return {
    version: 1,
    id,
    strategyId: config.id,
    strategyName: config.name,
    createdAt,
    dataSource,
    dataLatestDate,
    config: cloneStrategy(config),
    metrics: { ...result.metrics },
    equityCurve: result.equityCurve.map((point) => ({ ...point })),
    benchmarkName: result.benchmark?.name,
    warnings: [...result.warnings]
  };
}

export function prependBacktestSnapshot(
  snapshots: BacktestSnapshot[],
  snapshot: BacktestSnapshot,
  limit = maxBacktestSnapshots
): BacktestSnapshot[] {
  return [snapshot, ...snapshots.filter((item) => item.id !== snapshot.id)].slice(
    0,
    Math.max(1, limit)
  );
}

export function snapshotFileStem(snapshot: BacktestSnapshot): string {
  const name = snapshot.strategyName
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "strategy";
  const timestamp = snapshot.createdAt.replace(/[:.]/g, "-");
  return `${name}-${timestamp}`;
}

export function serializeSnapshotJson(snapshot: BacktestSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeSnapshotCsv(snapshot: BacktestSnapshot): string {
  const header = [
    "date",
    "strategy_equity",
    "benchmark_equity",
    "daily_return",
    "drawdown",
    "excess_return"
  ];
  const rows = snapshot.equityCurve.map((point) =>
    [
      point.date,
      point.equity,
      point.benchmarkEquity,
      point.dailyReturn,
      point.drawdown,
      point.excessReturn
    ]
      .map(csvCell)
      .join(",")
  );

  return [header.join(","), ...rows].join("\r\n");
}
