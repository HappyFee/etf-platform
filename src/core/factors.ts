import { maxDrawdown, mean, rollingReturns, safeDivide, standardDeviation } from "./math";
import type {
  EvaluationResult,
  EvaluationRow,
  FactorDefinition,
  FactorParams,
  FactorSelection,
  FilterOperator,
  FilterRule,
  MarketBar,
  StrategyConfig,
  EtfProfile
} from "./types";

interface EvaluateUniverseInput {
  barsBySymbol: Map<string, MarketBar[]>;
  profiles: EtfProfile[];
  config: StrategyConfig;
  date: string;
}

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
  const firstHalf = mean(closes.slice(0, Math.floor(window / 2)));
  const secondHalf = mean(closes.slice(Math.floor(window / 2)));
  return safeDivide(secondHalf, firstHalf) - 1;
}

function drawdownFactor(bars: MarketBar[], index: number, window: number): number | null {
  const closes = windowCloses(bars, index, window);
  if (closes.length < window) {
    return null;
  }
  return maxDrawdown(closes);
}

export const factorCatalog: FactorDefinition[] = [
  {
    id: "return_20d",
    name: "20日动量",
    category: "momentum",
    description: "近 20 个交易日涨跌幅，越高代表短期相对强势。",
    defaultDirection: "desc",
    defaultParams: { window: 20 },
    compute: ({ bars, index, params }) =>
      simpleReturn(bars, index, numberParam(params, "window", 20))
  },
  {
    id: "return_60d",
    name: "60日动量",
    category: "momentum",
    description: "近 60 个交易日涨跌幅，常用于 ETF 轮动主因子。",
    defaultDirection: "desc",
    defaultParams: { window: 60 },
    compute: ({ bars, index, params }) =>
      simpleReturn(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "return_120d",
    name: "120日动量",
    category: "momentum",
    description: "近 120 个交易日涨跌幅，偏中长期趋势。",
    defaultDirection: "desc",
    defaultParams: { window: 120 },
    compute: ({ bars, index, params }) =>
      simpleReturn(bars, index, numberParam(params, "window", 120))
  },
  {
    id: "close_ma20_ratio",
    name: "收盘/20日均线",
    category: "trend",
    description: "收盘价相对 20 日均线的位置，用于识别趋势强度。",
    defaultDirection: "desc",
    defaultParams: { window: 20 },
    compute: ({ bars, index, params }) =>
      closeToMovingAverage(bars, index, numberParam(params, "window", 20))
  },
  {
    id: "close_ma60_ratio",
    name: "收盘/60日均线",
    category: "trend",
    description: "收盘价相对 60 日均线的位置，适合中期轮动。",
    defaultDirection: "desc",
    defaultParams: { window: 60 },
    compute: ({ bars, index, params }) =>
      closeToMovingAverage(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "volatility_20d",
    name: "20日波动率",
    category: "risk",
    description: "近 20 日年化波动率，普通投资者配置中通常越低越好。",
    defaultDirection: "asc",
    defaultParams: { window: 20 },
    compute: ({ bars, index, params }) =>
      annualizedVolatility(bars, index, numberParam(params, "window", 20))
  },
  {
    id: "volatility_60d",
    name: "60日波动率",
    category: "risk",
    description: "近 60 日年化波动率，适合做稳健性约束。",
    defaultDirection: "asc",
    defaultParams: { window: 60 },
    compute: ({ bars, index, params }) =>
      annualizedVolatility(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "max_drawdown_60d",
    name: "60日最大回撤",
    category: "risk",
    description: "近 60 日区间内最大回撤，越低代表路径更平稳。",
    defaultDirection: "asc",
    defaultParams: { window: 60 },
    compute: ({ bars, index, params }) =>
      drawdownFactor(bars, index, numberParam(params, "window", 60))
  },
  {
    id: "max_drawdown_120d",
    name: "120日最大回撤",
    category: "risk",
    description: "近 120 日最大回撤，用于中期风险过滤。",
    defaultDirection: "asc",
    defaultParams: { window: 120 },
    compute: ({ bars, index, params }) =>
      drawdownFactor(bars, index, numberParam(params, "window", 120))
  },
  {
    id: "amount_ma20",
    name: "20日成交额",
    category: "liquidity",
    description: "近 20 日平均成交额，用于过滤流动性不足的 ETF。",
    defaultDirection: "desc",
    defaultParams: { window: 20 },
    compute: ({ bars, index, params }) =>
      movingAverageAmount(bars, index, numberParam(params, "window", 20))
  },
  {
    id: "trend_slope_60d",
    name: "60日趋势斜率",
    category: "trend",
    description: "比较窗口前后半段均价，刻画趋势抬升速度。",
    defaultDirection: "desc",
    defaultParams: { window: 60 },
    compute: ({ bars, index, params }) =>
      trendSlope(bars, index, numberParam(params, "window", 60))
  }
];

export function getFactorDefinition(id: string): FactorDefinition | undefined {
  return factorCatalog.find((factor) => factor.id === id);
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
  const definition = getFactorDefinition(factorId);
  const index = findBarIndexAtOrBefore(bars, date);

  if (!definition || index < 0) {
    return null;
  }

  return definition.compute({
    bars,
    index,
    params: { ...definition.defaultParams, ...params }
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
  selection: FactorSelection,
  rawValues: Map<string, number | null>
): void {
  const finite = rows
    .map((row) => ({ row, value: rawValues.get(row.symbol) ?? null }))
    .filter((item): item is { row: EvaluationRow; value: number } =>
      Number.isFinite(item.value)
    )
    .sort((left, right) =>
      selection.direction === "desc" ? right.value - left.value : left.value - right.value
    );

  const denominator = Math.max(1, finite.length - 1);
  const normalized = new Map<string, number>();

  finite.forEach((item, index) => {
    normalized.set(item.row.symbol, finite.length === 1 ? 1 : 1 - index / denominator);
  });

  for (const row of rows) {
    const raw = rawValues.get(row.symbol) ?? null;
    row.factorScores[selection.id] = {
      raw,
      normalized: normalized.get(row.symbol) ?? 0,
      direction: selection.direction,
      weight: selection.weight
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

  const activeFactors = requestedActiveFactors.filter((factor) => {
    const exists = Boolean(getFactorDefinition(factor.id));
    if (!exists) {
      warnings.push(`未知因子：${factor.id}`);
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

  for (const selection of activeFactors) {
    const rawValues = new Map<string, number | null>();
    for (const row of rows) {
      const bars = input.barsBySymbol.get(row.symbol)!;
      rawValues.set(
        row.symbol,
        computeFactorValue(selection.id, bars, input.date, selection.params)
      );
    }
    normalizeFactor(rows, selection, rawValues);
  }

  for (const row of rows) {
    let score = 0;
    let weightTotal = 0;

    for (const selection of activeFactors) {
      const detail = row.factorScores[selection.id];
      if (!detail) {
        continue;
      }
      score += detail.normalized * selection.weight;
      weightTotal += selection.weight;
    }

    row.score = weightTotal > 0 ? score / weightTotal : 0;
  }

  rows.sort((left, right) => right.score - left.score);

  return { date: input.date, rows, warnings: uniqueWarnings(warnings) };
}
