import { maxDrawdown, mean, rollingReturns, safeDivide, standardDeviation } from "./math";
import type {
  BaseStrategyConfig,
  EtfProfile,
  EvaluationResult,
  EvaluationRow,
  FactorDefinition,
  FactorParams,
  FactorSelection,
  FilterOperator,
  FilterRule,
  MarketBar
} from "./types";

interface EvaluateUniverseInput {
  barsBySymbol: Map<string, MarketBar[]>;
  profiles: EtfProfile[];
  config: BaseStrategyConfig;
  date: string;
}

interface ActiveFactor {
  selection: FactorSelection;
  scoreKey: string;
}

const windowParamSchema = [
  {
    key: "window",
    label: "窗口",
    min: 5,
    max: 252,
    step: 1
  }
];

function numberParam(params: FactorParams, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function windowCloses(bars: MarketBar[], index: number, window: number): number[] {
  if (index < window - 1) {
    return [];
  }
  return bars.slice(index - window + 1, index + 1).map((bar) => bar.close);
}

function simpleReturn(bars: MarketBar[], index: number, window: number): number | null {
  if (index < window) {
    return null;
  }
  const previous = bars[index - window].close;
  return safeDivide(bars[index].close, previous) - 1;
}

function closeToMovingAverage(
  bars: MarketBar[],
  index: number,
  window: number
): number | null {
  const closes = windowCloses(bars, index, window);
  if (closes.length < window) {
    return null;
  }
  return safeDivide(bars[index].close, mean(closes)) - 1;
}

function annualizedVolatility(
  bars: MarketBar[],
  index: number,
  window: number
): number | null {
  const closes = windowCloses(bars, index, window + 1);
  if (closes.length < window + 1) {
    return null;
  }
  return standardDeviation(rollingReturns(closes)) * Math.sqrt(252);
}

function movingAverageAmount(
  bars: MarketBar[],
  index: number,
  window: number
): number | null {
  if (index < window - 1) {
    return null;
  }
  return mean(bars.slice(index - window + 1, index + 1).map((bar) => bar.amount));
}

function trendSlope(bars: MarketBar[], index: number, window: number): number | null {
  const closes = windowCloses(bars, index, window);
  if (closes.length < window) {
    return null;
  }
  const midpoint = Math.floor(window / 2);
  const firstHalf = mean(closes.slice(0, midpoint));
  const secondHalf = mean(closes.slice(midpoint));
  return safeDivide(secondHalf, firstHalf) - 1;
}

function drawdownFactor(bars: MarketBar[], index: number, window: number): number | null {
  const closes = windowCloses(bars, index, window);
  if (closes.length < window) {
    return null;
  }
  return maxDrawdown(closes);
}

function factorName(base: string, params: FactorParams): string {
  const window = numberParam(params, "window", 0);
  return window > 0 ? `${base}(${window})` : base;
}

export const factorCatalog: FactorDefinition[] = [
  {
    id: "return",
    name: "区间动量",
    category: "momentum",
    description: "指定窗口内的涨跌幅。窗口越短越敏感，窗口越长越偏中期趋势。",
    defaultDirection: "desc",
    defaultParams: { window: 60 },
    paramSchema: windowParamSchema,
    compute: ({ bars, index, params }) =>
      simpleReturn(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "close_ma_ratio",
    name: "收盘/均线",
    category: "trend",
    description: "收盘价相对指定窗口均线的位置，用于刻画趋势强度。",
    defaultDirection: "desc",
    defaultParams: { window: 60 },
    paramSchema: windowParamSchema,
    compute: ({ bars, index, params }) =>
      closeToMovingAverage(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "volatility",
    name: "年化波动率",
    category: "risk",
    description: "指定窗口内的年化波动率，普通投资者配置中通常越低越好。",
    defaultDirection: "asc",
    defaultParams: { window: 20 },
    paramSchema: windowParamSchema,
    compute: ({ bars, index, params }) =>
      annualizedVolatility(bars, index, numberParam(params, "window", 20))
  },
  {
    id: "max_drawdown",
    name: "最大回撤",
    category: "risk",
    description: "指定窗口内的最大回撤，越低代表路径更平稳。",
    defaultDirection: "asc",
    defaultParams: { window: 60 },
    paramSchema: windowParamSchema,
    compute: ({ bars, index, params }) =>
      drawdownFactor(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "amount_ma",
    name: "平均成交额",
    category: "liquidity",
    description: "指定窗口内的平均成交额，用于过滤流动性不足的 ETF。",
    defaultDirection: "desc",
    defaultParams: { window: 20 },
    paramSchema: windowParamSchema,
    compute: ({ bars, index, params }) =>
      movingAverageAmount(bars, index, numberParam(params, "window", 20))
  },
  {
    id: "trend_slope",
    name: "趋势斜率",
    category: "trend",
    description: "比较窗口前后半段均价，刻画趋势抬升速度。",
    defaultDirection: "desc",
    defaultParams: { window: 60 },
    paramSchema: windowParamSchema,
    compute: ({ bars, index, params }) =>
      trendSlope(bars, index, numberParam(params, "window", 60))
  }
];

const legacyFactorAliases: Record<string, { id: string; params: FactorParams }> = {
  return_20d: { id: "return", params: { window: 20 } },
  return_60d: { id: "return", params: { window: 60 } },
  return_120d: { id: "return", params: { window: 120 } },
  close_ma20_ratio: { id: "close_ma_ratio", params: { window: 20 } },
  close_ma60_ratio: { id: "close_ma_ratio", params: { window: 60 } },
  volatility_20d: { id: "volatility", params: { window: 20 } },
  volatility_60d: { id: "volatility", params: { window: 60 } },
  max_drawdown_60d: { id: "max_drawdown", params: { window: 60 } },
  max_drawdown_120d: { id: "max_drawdown", params: { window: 120 } },
  amount_ma20: { id: "amount_ma", params: { window: 20 } },
  trend_slope_60d: { id: "trend_slope", params: { window: 60 } }
};

export function getFactorDefinition(id: string): FactorDefinition | undefined {
  const canonicalId = legacyFactorAliases[id]?.id ?? id;
  return factorCatalog.find((factor) => factor.id === canonicalId);
}

export function getFactorDisplayName(selection: FactorSelection): string {
  const definition = getFactorDefinition(selection.id);
  if (!definition) {
    return selection.id;
  }
  return factorName(definition.name, {
    ...definition.defaultParams,
    ...(legacyFactorAliases[selection.id]?.params ?? {}),
    ...(selection.params ?? {})
  });
}

export function factorScoreKey(selection: FactorSelection, index: number): string {
  return selection.key ?? `${selection.id}-${index}`;
}

export function findBarIndexAtOrBefore(bars: MarketBar[], date: string): number {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].date <= date) {
      return index;
    }
  }
  return -1;
}

export function computeFactorValue(
  factorId: string,
  bars: MarketBar[],
  date: string,
  params: FactorParams = {}
): number | null {
  const alias = legacyFactorAliases[factorId];
  const definition = getFactorDefinition(factorId);
  const index = findBarIndexAtOrBefore(bars, date);

  if (!definition || index < 0) {
    return null;
  }

  return definition.compute({
    bars,
    index,
    params: { ...definition.defaultParams, ...(alias?.params ?? {}), ...params }
  });
}

function compareFilter(value: number | null, operator: FilterOperator, target: number): boolean {
  if (value === null || !Number.isFinite(value)) {
    return false;
  }

  if (operator === ">") {
    return value > target;
  }
  if (operator === ">=") {
    return value >= target;
  }
  if (operator === "<") {
    return value < target;
  }
  return value <= target;
}

function normalizeFactor(
  rows: EvaluationRow[],
  active: ActiveFactor,
  rawValues: Map<string, number | null>
): void {
  const finite = rows
    .map((row) => ({ row, value: rawValues.get(row.symbol) ?? null }))
    .filter((item): item is { row: EvaluationRow; value: number } =>
      Number.isFinite(item.value)
    )
    .sort((left, right) =>
      active.selection.direction === "desc"
        ? right.value - left.value
        : left.value - right.value
    );

  const denominator = Math.max(1, finite.length - 1);
  const normalized = new Map<string, number>();

  finite.forEach((item, index) => {
    normalized.set(item.row.symbol, finite.length === 1 ? 1 : 1 - index / denominator);
  });

  for (const row of rows) {
    const raw = rawValues.get(row.symbol) ?? null;
    row.factorScores[active.scoreKey] = {
      raw,
      normalized: normalized.get(row.symbol) ?? 0,
      direction: active.selection.direction,
      weight: active.selection.weight
    };
  }
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

export function evaluateUniverse(input: EvaluateUniverseInput): EvaluationResult {
  const warnings: string[] = [];
  const requestedActiveFactors = input.config.factors.filter(
    (factor) => factor.enabled && factor.weight > 0
  );

  const activeFactors: ActiveFactor[] = requestedActiveFactors
    .map((selection, index) => ({
      selection,
      scoreKey: factorScoreKey(selection, index)
    }))
    .filter((active) => {
      const exists = Boolean(getFactorDefinition(active.selection.id));
      if (!exists) {
        warnings.push(`未知因子：${active.selection.id}`);
      }
      return exists;
    });

  if (requestedActiveFactors.length === 0 || activeFactors.length === 0) {
    warnings.push("至少需要启用一个权重大于 0 的因子。");
    return { date: input.date, rows: [], warnings: uniqueWarnings(warnings) };
  }

  const profileBySymbol = new Map(input.profiles.map((profile) => [profile.symbol, profile]));
  const rows: EvaluationRow[] = [];

  for (const symbol of input.config.universe) {
    const profile = profileBySymbol.get(symbol);
    const bars = input.barsBySymbol.get(symbol);

    if (!profile || !bars) {
      warnings.push(`${symbol} 缺少 ETF 元数据或行情数据。`);
      continue;
    }

    const filterValues: Record<string, number | null> = {};
    const passesFilters = input.config.filters.every((filter: FilterRule) => {
      const value = computeFactorValue(filter.factorId, bars, input.date, filter.params);
      filterValues[filter.factorId] = value;
      return compareFilter(value, filter.operator, filter.value);
    });

    if (!passesFilters) {
      continue;
    }

    rows.push({
      symbol,
      name: profile.name,
      category: profile.category,
      score: 0,
      passesFilters,
      factorScores: {},
      filterValues
    });
  }

  if (rows.length === 0) {
    warnings.push("过滤条件移除了所有 ETF，当前日期无法生成持仓。");
    return { date: input.date, rows, warnings: uniqueWarnings(warnings) };
  }

  for (const active of activeFactors) {
    const rawValues = new Map<string, number | null>();
    for (const row of rows) {
      const bars = input.barsBySymbol.get(row.symbol)!;
      rawValues.set(
        row.symbol,
        computeFactorValue(active.selection.id, bars, input.date, active.selection.params)
      );
    }
    normalizeFactor(rows, active, rawValues);
  }

  for (const row of rows) {
    let score = 0;
    let weightTotal = 0;

    for (const active of activeFactors) {
      const detail = row.factorScores[active.scoreKey];
      if (!detail) {
        continue;
      }
      score += detail.normalized * active.selection.weight;
      weightTotal += active.selection.weight;
    }

    row.score = weightTotal > 0 ? score / weightTotal : 0;
  }

  rows.sort((left, right) => right.score - left.score);

  return { date: input.date, rows, warnings: uniqueWarnings(warnings) };
}
