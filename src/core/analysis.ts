import { tradingDays } from "./date";
import { runBacktest } from "./backtest";
import { groupBarsBySymbol } from "./sampleData";
import type {
  BacktestResult,
  BaseStrategyConfig,
  DataQualityReport,
  DataQualitySymbol,
  EtfProfile,
  MarketBar,
  RobustnessCase,
  RobustnessReport,
  StrategyConfig,
  ValidationCheck,
  ValidationReport,
  ValidationSegment
} from "./types";

function cloneStrategy<T extends StrategyConfig>(strategy: T): T {
  return JSON.parse(JSON.stringify(strategy)) as T;
}

function isBaseStrategy(config: StrategyConfig): config is BaseStrategyConfig {
  return config.kind === "base";
}

function amountLooksEstimated(bar: MarketBar): boolean {
  if (bar.volume <= 0 || bar.close <= 0 || bar.amount <= 0) {
    return false;
  }
  const estimated = bar.volume * bar.close;
  return Math.abs(bar.amount - estimated) / Math.max(1, estimated) < 0.001;
}

function symbolQuality(
  profile: EtfProfile,
  bars: MarketBar[],
  fullDates: string[]
): DataQualitySymbol {
  const dates = new Set(bars.map((bar) => bar.date));
  const amounts = bars.map((bar) => bar.amount).filter((amount) => amount > 0);
  const startDate = bars.at(0)?.date ?? "";
  const latestDate = bars.at(-1)?.date ?? "";
  const expectedDates = fullDates.filter((date) => date >= startDate && date <= latestDate);
  const missingDays = expectedDates.filter((date) => !dates.has(date)).length;
  const coverageRatio =
    expectedDates.length === 0 ? 0 : (expectedDates.length - missingDays) / expectedDates.length;
  const estimatedAmountCount = bars.filter(amountLooksEstimated).length;
  const warnings: string[] = [];

  if (bars.length === 0) {
    warnings.push("缺少行情数据");
  }
  if (coverageRatio < 0.98) {
    warnings.push("交易日覆盖率偏低");
  }
  if (estimatedAmountCount / Math.max(1, bars.length) > 0.8) {
    warnings.push("成交额疑似由收盘价和成交量估算");
  }

  return {
    symbol: profile.symbol,
    name: profile.name,
    startDate,
    latestDate,
    barCount: bars.length,
    missingDays,
    coverageRatio,
    averageAmount:
      amounts.length === 0
        ? 0
        : amounts.reduce((total, amount) => total + amount, 0) / amounts.length,
    warnings
  };
}

export function buildDataQualityReport(
  bars: MarketBar[],
  profiles: EtfProfile[]
): DataQualityReport {
  const barsBySymbol = groupBarsBySymbol(bars);
  const allDates = bars.map((bar) => bar.date).sort();
  const earliestDate = allDates[0] ?? "";
  const latestDate = allDates.at(-1) ?? "";
  const fullDates = earliestDate && latestDate ? tradingDays(earliestDate, latestDate) : [];
  const symbols = profiles.map((profile) =>
    symbolQuality(profile, barsBySymbol.get(profile.symbol) ?? [], fullDates)
  );
  const latestDates = new Set(symbols.map((symbol) => symbol.latestDate).filter(Boolean));
  const staleSymbols = symbols
    .filter((symbol) => symbol.latestDate && symbol.latestDate !== latestDate)
    .map((symbol) => symbol.symbol);
  const estimatedAmountSymbols = symbols
    .filter((symbol) => symbol.warnings.includes("成交额疑似由收盘价和成交量估算"))
    .map((symbol) => symbol.symbol);
  const warnings: string[] = [];

  if (latestDates.size > 1) {
    warnings.push("ETF 最新日期不一致，需要检查数据源是否部分滞后");
  }
  if (staleSymbols.length > 0) {
    warnings.push(`${staleSymbols.length} 只 ETF 数据滞后`);
  }
  if (estimatedAmountSymbols.length > 0) {
    warnings.push(`${estimatedAmountSymbols.length} 只 ETF 成交额可能是估算值，流动性因子需谨慎解读`);
  }

  return {
    latestDate,
    earliestDate,
    symbolCount: profiles.length,
    staleSymbols,
    estimatedAmountSymbols,
    symbols,
    warnings
  };
}

function robustnessCase(name: string, result: BacktestResult): RobustnessCase {
  return {
    name,
    totalReturn: result.metrics.totalReturn,
    annualizedReturn: result.metrics.annualizedReturn,
    maxDrawdown: result.metrics.maxDrawdown,
    sharpe: result.metrics.sharpe
  };
}

function withExecutionStress(config: StrategyConfig): StrategyConfig {
  const next = cloneStrategy(config);
  next.transactionCostBps += 10;
  next.execution = {
    price: next.execution?.price ?? "next_close",
    slippageBps: (next.execution?.slippageBps ?? 3) + 7
  };
  return next;
}

function withFirstWindow(config: BaseStrategyConfig, multiplier: number): BaseStrategyConfig {
  const next = cloneStrategy(config);
  const firstWindowFactor = next.factors.find(
    (factor) => typeof factor.params?.window === "number"
  );

  if (firstWindowFactor?.params && typeof firstWindowFactor.params.window === "number") {
    firstWindowFactor.params.window = Math.max(
      5,
      Math.round(firstWindowFactor.params.window * multiplier)
    );
  }

  return next;
}

export function buildRobustnessReport({
  bars,
  profiles,
  config,
  strategyBook
}: {
  bars: MarketBar[];
  profiles: EtfProfile[];
  config: StrategyConfig;
  strategyBook: StrategyConfig[];
}): RobustnessReport {
  const stressedCost = runBacktest({
    bars,
    profiles,
    config: withExecutionStress(config),
    strategyBook
  });
  const cases = [robustnessCase("成本+滑点压力", stressedCost)];

  if (isBaseStrategy(config)) {
    const shorterWindow = runBacktest({
      bars,
      profiles,
      config: withFirstWindow(config, 0.75),
      strategyBook
    });
    const longerWindow = runBacktest({
      bars,
      profiles,
      config: withFirstWindow(config, 1.25),
      strategyBook
    });
    cases.push(
      robustnessCase("首个窗口缩短25%", shorterWindow),
      robustnessCase("首个窗口延长25%", longerWindow)
    );
  }

  const negativeCases = cases.filter((item) => item.totalReturn < 0).length;
  const summary =
    negativeCases === 0
      ? "压力场景仍保持正收益，参数稳定性较好。"
      : `${negativeCases}/${cases.length} 个压力场景为负收益，建议降低参数依赖或扩大样本外验证。`;

  return { cases, summary };
}

function validationSegment(result: BacktestResult): ValidationSegment | undefined {
  const startDate = result.equityCurve[0]?.date;
  const endDate = result.equityCurve.at(-1)?.date;
  if (!startDate || !endDate) {
    return undefined;
  }

  return {
    startDate,
    endDate,
    totalReturn: result.metrics.totalReturn,
    annualizedReturn: result.metrics.annualizedReturn,
    maxDrawdown: result.metrics.maxDrawdown,
    sharpe: result.metrics.sharpe
  };
}

function causalityReplayCheck({
  bars,
  profiles,
  config,
  strategyBook,
  result
}: {
  bars: MarketBar[];
  profiles: EtfProfile[];
  config: StrategyConfig;
  strategyBook: StrategyConfig[];
  result: BacktestResult;
}): ValidationCheck {
  if (!isBaseStrategy(config)) {
    return {
      label: "历史截断重放",
      status: "warn",
      detail: "组合层请分别检查各基础子策略的截断重放结果"
    };
  }

  const candidates = result.rebalances.filter(
    (event) => event.signalDate && event.rankings.length > 0
  );
  if (candidates.length === 0) {
    return {
      label: "历史截断重放",
      status: "warn",
      detail: "当前区间没有可用于重放的历史调仓信号"
    };
  }

  const sampleIndexes = [
    0,
    Math.floor((candidates.length - 1) / 2),
    candidates.length - 1
  ];
  const samples = [...new Set(sampleIndexes)].map((index) => candidates[index]);
  let mismatches = 0;

  for (const event of samples) {
    const signalDate = event.signalDate!;
    const replayConfig = {
      ...cloneStrategy(config),
      backtestEndDate: signalDate
    } as StrategyConfig;
    const replay = runBacktest({
      bars: bars.filter((bar) => bar.date <= signalDate),
      profiles,
      config: replayConfig,
      strategyBook
    });
    const expected = event.rankings
      .slice(0, 10)
      .map((row) => row.symbol)
      .join(",");
    const actual = replay.latestSignal.rankings
      .slice(0, 10)
      .map((row) => row.symbol)
      .join(",");
    if (expected !== actual) {
      mismatches += 1;
    }
  }

  return {
    label: "历史截断重放",
    status: mismatches === 0 ? "pass" : "warn",
    detail:
      mismatches === 0
        ? `抽样 ${samples.length} 个信号，截断未来数据后排名保持一致`
        : `${mismatches}/${samples.length} 个抽样信号在截断未来数据后发生变化`
  };
}

export function buildValidationReport({
  bars,
  profiles,
  config,
  strategyBook,
  result
}: {
  bars: MarketBar[];
  profiles: EtfProfile[];
  config: StrategyConfig;
  strategyBook: StrategyConfig[];
  result?: BacktestResult;
}): ValidationReport {
  const dates = [...new Set(bars.map((bar) => bar.date))]
    .sort()
    .filter(
      (date) =>
        (!config.backtestStartDate || date >= config.backtestStartDate) &&
        (!config.backtestEndDate || date <= config.backtestEndDate)
    );
  const fullResult =
    result ?? runBacktest({ bars, profiles, config, strategyBook });
  const signalViolations = fullResult.rebalances.filter(
    (event) =>
      !event.signalDate || !event.tradeDate || event.signalDate >= event.tradeDate
  ).length;
  const checks: ValidationReport["checks"] = [
    {
      label: "信号与成交分离",
      status: signalViolations === 0 ? "pass" : "warn",
      detail:
        signalViolations === 0
          ? "全部调仓均使用下一交易日成交"
          : `${signalViolations} 次调仓未满足 T+1 成交`
    }
  ];
  checks.push(
    causalityReplayCheck({
      bars,
      profiles,
      config,
      strategyBook,
      result: fullResult
    }),
    {
      label: "固定 ETF 池偏差",
      status: "warn",
      detail: "ETF 池未记录历史成分变更，仍需警惕幸存者偏差"
    }
  );

  if (dates.length < 120) {
    return {
      splitDate: "",
      status: "unavailable",
      summary: "有效区间不足 120 个交易日，暂不生成样本外判断。",
      checks
    };
  }

  const splitIndex = Math.min(
    dates.length - 60,
    Math.max(60, Math.floor(dates.length * 0.7))
  );
  const splitDate = dates[splitIndex];
  const inSampleEndDate = dates[splitIndex - 1];
  const inSampleConfig = {
    ...cloneStrategy(config),
    backtestStartDate: dates[0],
    backtestEndDate: inSampleEndDate
  } as StrategyConfig;
  const outOfSampleConfig = {
    ...cloneStrategy(config),
    backtestStartDate: splitDate,
    backtestEndDate: dates.at(-1)
  } as StrategyConfig;
  const inSampleResult = runBacktest({
    bars,
    profiles,
    config: inSampleConfig,
    strategyBook
  });
  const outOfSampleResult = runBacktest({
    bars,
    profiles,
    config: outOfSampleConfig,
    strategyBook
  });
  const inSample = validationSegment(inSampleResult);
  const outOfSample = validationSegment(outOfSampleResult);

  if (!inSample || !outOfSample) {
    return {
      splitDate,
      inSample,
      outOfSample,
      status: "unavailable",
      summary: "切分后的有效回测数据不足，暂不生成样本外判断。",
      checks
    };
  }

  const weakSignals = [
    outOfSample.annualizedReturn < 0,
    outOfSample.sharpe < 0,
    outOfSample.maxDrawdown > Math.max(0.1, inSample.maxDrawdown * 1.5),
    inSample.annualizedReturn * outOfSample.annualizedReturn < 0
  ].filter(Boolean).length;
  const status = weakSignals === 0 ? "stable" : weakSignals === 1 ? "mixed" : "weak";
  const summary =
    status === "stable"
      ? "样本外收益和风险调整表现保持为正，当前参数稳定性较好。"
      : status === "mixed"
        ? "样本内外有一项关键指标不一致或转弱，建议缩小仓位或继续观察。"
        : "样本外收益或风险明显恶化，不建议仅凭全区间结果使用。";

  return {
    splitDate,
    inSample,
    outOfSample,
    status,
    summary,
    checks
  };
}
