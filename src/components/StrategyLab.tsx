import { Copy, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultBenchmarkSymbol,
  universeEqualWeightBenchmark
} from "../core/defaultStrategy";
import { factorCatalog, getFactorDisplayName } from "../core/factors";
import type {
  BacktestResult,
  BaseStrategyConfig,
  CompositeStrategyConfig,
  EtfProfile,
  ExecutionConfig,
  FactorDirection,
  FactorSelection,
  FilterOperator,
  FilterRule,
  RebalanceFrequency,
  StrategyConfig,
  WeightingMethod
} from "../core/types";
import { formatPercent, Section } from "./ui";

function boundedNumber(
  value: number,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function BacktestSettingsControls({
  config,
  profiles,
  onChange
}: {
  config: StrategyConfig;
  profiles: EtfProfile[];
  onChange: (config: StrategyConfig) => void;
}) {
  const benchmarkSymbol = config.benchmarkSymbol ?? defaultBenchmarkSymbol;

  return (
    <>
      <label>
        对比基准
        <select
          data-testid="benchmark-select"
          value={benchmarkSymbol}
          onChange={(event) =>
            onChange({ ...config, benchmarkSymbol: event.target.value })
          }
        >
          <option value={universeEqualWeightBenchmark}>ETF 池等权</option>
          {profiles.map((profile) => (
            <option key={profile.symbol} value={profile.symbol}>
              {profile.symbol} · {profile.name}
            </option>
          ))}
          {benchmarkSymbol !== universeEqualWeightBenchmark &&
            !profiles.some((profile) => profile.symbol === benchmarkSymbol) && (
              <option value={benchmarkSymbol}>{benchmarkSymbol}</option>
            )}
        </select>
      </label>
      <label>
        回测开始
        <input
          data-testid="backtest-start-date"
          max={config.backtestEndDate}
          type="date"
          value={config.backtestStartDate ?? ""}
          onChange={(event) =>
            onChange({
              ...config,
              backtestStartDate: event.target.value || undefined
            })
          }
        />
      </label>
      <label>
        回测结束
        <input
          data-testid="backtest-end-date"
          min={config.backtestStartDate}
          type="date"
          value={config.backtestEndDate ?? ""}
          onChange={(event) =>
            onChange({
              ...config,
              backtestEndDate: event.target.value || undefined
            })
          }
        />
      </label>
    </>
  );
}

function ExecutionSettingsControls({
  config,
  onChange
}: {
  config: StrategyConfig;
  onChange: (config: StrategyConfig) => void;
}) {
  const execution: ExecutionConfig = {
    price: config.execution?.price ?? "next_close",
    slippageBps: config.execution?.slippageBps ?? 3,
    initialCapital: config.execution?.initialCapital ?? 100_000,
    minimumCommission:
      config.execution?.minimumCommission ?? (config.kind === "composite" ? 0 : 5),
    maxParticipationRate: config.execution?.maxParticipationRate ?? 0.1,
    priceLimitThreshold: config.execution?.priceLimitThreshold ?? 0.1
  };

  function updateExecution(patch: Partial<ExecutionConfig>) {
    onChange({
      ...config,
      execution: {
        ...execution,
        ...patch
      }
    });
  }

  return (
    <div className="control-grid execution-grid">
      <label>
        成交时点
        <select
          data-testid="execution-price-select"
          value={execution.price}
          onChange={(event) =>
            updateExecution({ price: event.target.value as ExecutionConfig["price"] })
          }
        >
          <option value="next_close">下一交易日收盘</option>
          <option value="next_open">下一交易日开盘</option>
        </select>
      </label>
      <label>
        滑点 bps
        <input
          data-testid="slippage-input"
          max={100}
          min={0}
          step={1}
          type="number"
          value={execution.slippageBps}
          onChange={(event) =>
            updateExecution({
              slippageBps: boundedNumber(
                Number(event.target.value),
                execution.slippageBps,
                0,
                100
              )
            })
          }
        />
      </label>
      <label>
        初始资金（万元）
        <input
          data-testid="initial-capital-input"
          max={100_000}
          min={0.1}
          step={1}
          type="number"
          value={(execution.initialCapital ?? 100_000) / 10_000}
          onChange={(event) =>
            updateExecution({
              initialCapital:
                boundedNumber(
                  Number(event.target.value),
                  (execution.initialCapital ?? 100_000) / 10_000,
                  0.1,
                  100_000
                ) * 10_000
            })
          }
        />
      </label>
      <label>
        单笔最低佣金（元）
        <input
          data-testid="minimum-commission-input"
          max={1_000}
          min={0}
          step={1}
          type="number"
          value={execution.minimumCommission ?? 0}
          onChange={(event) =>
            updateExecution({
              minimumCommission: boundedNumber(
                Number(event.target.value),
                execution.minimumCommission ?? 0,
                0,
                1_000
              )
            })
          }
        />
      </label>
      <label>
        最大成交占比（%）
        <input
          data-testid="participation-rate-input"
          max={100}
          min={0}
          step={1}
          type="number"
          value={(execution.maxParticipationRate ?? 0.1) * 100}
          onChange={(event) =>
            updateExecution({
              maxParticipationRate:
                boundedNumber(
                  Number(event.target.value),
                  (execution.maxParticipationRate ?? 0.1) * 100,
                  0,
                  100
                ) / 100
            })
          }
        />
      </label>
      <label>
        涨跌停阈值（%）
        <input
          data-testid="price-limit-input"
          max={100}
          min={0}
          step={0.5}
          type="number"
          value={(execution.priceLimitThreshold ?? 0.1) * 100}
          onChange={(event) =>
            updateExecution({
              priceLimitThreshold:
                boundedNumber(
                  Number(event.target.value),
                  (execution.priceLimitThreshold ?? 0.1) * 100,
                  0,
                  100
                ) / 100
            })
          }
        />
      </label>
    </div>
  );
}

function updateFactor(
  config: BaseStrategyConfig,
  key: string,
  patch: Partial<FactorSelection>
): BaseStrategyConfig {
  return {
    ...config,
    factors: config.factors.map((factor) =>
      (factor.key ?? factor.id) === key ? { ...factor, ...patch } : factor
    )
  };
}

function updateFactorParam(
  config: BaseStrategyConfig,
  key: string,
  paramKey: string,
  value: number
): BaseStrategyConfig {
  return {
    ...config,
    factors: config.factors.map((factor) =>
      (factor.key ?? factor.id) === key
        ? {
            ...factor,
            params: {
              ...(factor.params ?? {}),
              [paramKey]: value
            }
          }
        : factor
    )
  };
}

function createFactorSelection(factorId: string, index: number): FactorSelection {
  const definition = factorCatalog.find((factor) => factor.id === factorId) ?? factorCatalog[0];
  return {
    key: `${definition.id}-${Date.now()}-${index}`,
    id: definition.id,
    enabled: true,
    weight: 0.1,
    direction: definition.defaultDirection,
    params: { ...definition.defaultParams }
  };
}

function addFactor(config: BaseStrategyConfig, factorId: string): BaseStrategyConfig {
  return {
    ...config,
    factors: [...config.factors, createFactorSelection(factorId, config.factors.length)]
  };
}

function duplicateFactor(config: BaseStrategyConfig, factor: FactorSelection): BaseStrategyConfig {
  return {
    ...config,
    factors: [
      ...config.factors,
      {
        ...factor,
        key: `${factor.id}-${Date.now()}-${config.factors.length}`,
        params: { ...(factor.params ?? {}) }
      }
    ]
  };
}

function removeFactor(config: BaseStrategyConfig, key: string): BaseStrategyConfig {
  return {
    ...config,
    factors: config.factors.filter((factor) => (factor.key ?? factor.id) !== key)
  };
}

function updateLiquidityFilter(config: BaseStrategyConfig, value: number): BaseStrategyConfig {
  const nextFilter: FilterRule = {
    key: "liquidity-filter",
    factorId: "amount_ma",
    operator: ">=",
    value,
    params: { window: 20 }
  };

  const otherFilters = config.filters.filter((filter) => filter.factorId !== "amount_ma");
  return { ...config, filters: [nextFilter, ...otherFilters] };
}

function createFilterRule(index: number): FilterRule {
  return {
    key: `filter-${Date.now()}-${index}`,
    factorId: "amount_ma",
    operator: ">=",
    value: 100_000_000,
    params: { window: 20 }
  };
}

function updateFilter(
  config: BaseStrategyConfig,
  key: string,
  patch: Partial<FilterRule>
): BaseStrategyConfig {
  return {
    ...config,
    filters: config.filters.map((filter, index) =>
      (filter.key ?? `${filter.factorId}-${index}`) === key
        ? { ...filter, ...patch }
        : filter
    )
  };
}

function updateFilterParam(
  config: BaseStrategyConfig,
  key: string,
  paramKey: string,
  value: number
): BaseStrategyConfig {
  return {
    ...config,
    filters: config.filters.map((filter, index) =>
      (filter.key ?? `${filter.factorId}-${index}`) === key
        ? {
            ...filter,
            params: {
              ...(filter.params ?? {}),
              [paramKey]: value
            }
          }
        : filter
    )
  };
}

function removeFilter(config: BaseStrategyConfig, key: string): BaseStrategyConfig {
  return {
    ...config,
    filters: config.filters.filter(
      (filter, index) => (filter.key ?? `${filter.factorId}-${index}`) !== key
    )
  };
}

function normalizeFixedWeights(weights: number[], count: number): number[] {
  const next = Array.from({ length: count }, (_, index) => weights[index] ?? 0);
  const total = next.reduce((sum, weight) => sum + Math.max(0, weight), 0);

  if (total <= 0) {
    return next.map(() => Number((1 / Math.max(1, count)).toFixed(4)));
  }

  return next.map((weight) => Number((Math.max(0, weight) / total).toFixed(4)));
}

function updateFixedWeight(
  config: BaseStrategyConfig,
  rankIndex: number,
  weight: number
): BaseStrategyConfig {
  const fixedWeights = Array.from(
    { length: config.portfolio.topN },
    (_, index) => config.portfolio.fixedWeights?.[index] ?? 0
  );
  fixedWeights[rankIndex] = weight;

  return {
    ...config,
    portfolio: {
      ...config.portfolio,
      fixedWeights: normalizeFixedWeights(fixedWeights, config.portfolio.topN)
    }
  };
}

function baseStrategies(strategies: StrategyConfig[]): BaseStrategyConfig[] {
  return strategies.filter((strategy): strategy is BaseStrategyConfig => strategy.kind === "base");
}

function upsertComponent(
  config: CompositeStrategyConfig,
  strategyId: string,
  checked: boolean
): CompositeStrategyConfig {
  if (!checked) {
    return {
      ...config,
      components: config.components.filter((component) => component.strategyId !== strategyId)
    };
  }

  if (config.components.some((component) => component.strategyId === strategyId)) {
    return config;
  }

  return {
    ...config,
    components: [...config.components, { strategyId, weight: 0.5 }]
  };
}

function updateComponentWeight(
  config: CompositeStrategyConfig,
  strategyId: string,
  weight: number
): CompositeStrategyConfig {
  return {
    ...config,
    components: config.components.map((component) =>
      component.strategyId === strategyId ? { ...component, weight } : component
    )
  };
}

function StrategyToolbar({
  strategies,
  activeStrategyId,
  onSelect,
  onCreateBase,
  onCreateComposite,
  onDuplicate,
  onDelete
}: {
  strategies: StrategyConfig[];
  activeStrategyId: string;
  onSelect: (id: string) => void;
  onCreateBase: () => void;
  onCreateComposite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Section title="策略工作区" action={<span className="section-note">{strategies.length} 个策略</span>}>
      <div className="strategy-toolbar">
        <label>
          当前策略
          <select value={activeStrategyId} onChange={(event) => onSelect(event.target.value)}>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name} · {strategy.kind === "composite" ? "组合" : "基础"}
              </option>
            ))}
          </select>
        </label>
        <button className="text-action" onClick={onCreateBase} type="button">
          <Plus size={16} />
          新基础策略
        </button>
        <button className="text-action" onClick={onCreateComposite} type="button">
          <Plus size={16} />
          新组合策略
        </button>
        <button className="text-action" onClick={onDuplicate} type="button">
          <Copy size={16} />
          复制
        </button>
        <button className="text-action danger" onClick={onDelete} type="button">
          <Trash2 size={16} />
          删除
        </button>
      </div>
    </Section>
  );
}

function BaseStrategyEditor({
  config,
  result,
  profiles,
  onChange
}: {
  config: BaseStrategyConfig;
  result: BacktestResult;
  profiles: EtfProfile[];
  onChange: (config: StrategyConfig) => void;
}) {
  const factorById = new Map(factorCatalog.map((factor) => [factor.id, factor]));
  const liquidityFilter = config.filters.find((filter) => filter.factorId === "amount_ma");
  const [etfQuery, setEtfQuery] = useState("");
  const [factorToAdd, setFactorToAdd] = useState(factorCatalog[0]?.id ?? "return");
  const fixedWeights = normalizeFixedWeights(
    config.portfolio.fixedWeights ?? [],
    config.portfolio.topN
  );
  const etfMatches = useMemo(() => {
    const query = etfQuery.trim().toLowerCase();

    if (!query) {
      return profiles;
    }

    return profiles.filter(
      (profile) =>
        profile.symbol.toLowerCase().includes(query) ||
        profile.name.toLowerCase().includes(query) ||
        profile.category.toLowerCase().includes(query) ||
        profile.trackingIndex.toLowerCase().includes(query)
    );
  }, [etfQuery, profiles]);

  return (
    <>
      <Section title="组合规则">
        <div className="control-grid">
          <label>
            策略名称
            <input
              value={config.name}
              onChange={(event) => onChange({ ...config, name: event.target.value })}
            />
          </label>
          <BacktestSettingsControls
            config={config}
            onChange={onChange}
            profiles={profiles}
          />
          <label>
            调仓频率
            <select
              value={config.rebalance.frequency}
              onChange={(event) =>
                onChange({
                  ...config,
                  rebalance: {
                    ...config.rebalance,
                    frequency: event.target.value as RebalanceFrequency
                  }
                })
              }
            >
              <option value="daily">每日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </label>
          {config.rebalance.frequency === "weekly" && (
            <label>
              调仓周几
              <select
                value={config.rebalance.weeklyDay ?? 1}
                onChange={(event) =>
                  onChange({
                    ...config,
                    rebalance: {
                      ...config.rebalance,
                      weeklyDay: Math.round(
                        boundedNumber(Number(event.target.value), config.rebalance.weeklyDay ?? 1, 1, 5)
                      )
                    }
                  })
                }
              >
                <option value={1}>周一</option>
                <option value={2}>周二</option>
                <option value={3}>周三</option>
                <option value={4}>周四</option>
                <option value={5}>周五</option>
              </select>
            </label>
          )}
          {config.rebalance.frequency === "monthly" && (
            <label>
              调仓日期
              <input
                max={31}
                min={1}
                type="number"
                value={config.rebalance.monthlyDay ?? 1}
                onChange={(event) =>
                  onChange({
                    ...config,
                    rebalance: {
                      ...config.rebalance,
                      monthlyDay: Math.round(
                        boundedNumber(Number(event.target.value), config.rebalance.monthlyDay ?? 1, 1, 31)
                      )
                    }
                  })
                }
              />
            </label>
          )}
          <label>
            持仓数量
            <input
              max={6}
              min={1}
              type="number"
              value={config.portfolio.topN}
              onChange={(event) =>
                {
                  const topN = Math.round(
                    boundedNumber(Number(event.target.value), config.portfolio.topN, 1, 6)
                  );

                  onChange({
                    ...config,
                    portfolio: {
                      ...config.portfolio,
                      topN,
                      fixedWeights: normalizeFixedWeights(
                        config.portfolio.fixedWeights ?? [],
                        topN
                      )
                    }
                  });
                }
              }
            />
          </label>
          <label>
            仓位方式
            <select
              value={config.portfolio.weighting}
              onChange={(event) =>
                onChange({
                  ...config,
                  portfolio: {
                    ...config.portfolio,
                    weighting: event.target.value as WeightingMethod,
                    fixedWeights: normalizeFixedWeights(
                      config.portfolio.fixedWeights ?? [],
                      config.portfolio.topN
                    )
                  }
                })
              }
            >
              <option value="equal">等权</option>
              <option value="score">按得分</option>
              <option value="fixed">固定比例</option>
            </select>
          </label>
          <label>
            交易成本 bps
            <input
              max={50}
              min={0}
              type="number"
              value={config.transactionCostBps}
              onChange={(event) =>
                onChange({
                  ...config,
                  transactionCostBps: boundedNumber(
                    Number(event.target.value),
                    config.transactionCostBps,
                    0,
                    50
                  )
                })
              }
            />
          </label>
          <label>
            最大单仓
            <input
              data-testid="max-position-input"
              max={1}
              min={0}
              step={0.01}
              type="number"
              value={config.risk.maxPositionWeight ?? 1}
              onChange={(event) =>
                onChange({
                  ...config,
                  risk: {
                    ...config.risk,
                    maxPositionWeight: boundedNumber(
                      Number(event.target.value),
                      config.risk.maxPositionWeight ?? 1,
                      0,
                      1
                    )
                  }
                })
              }
            />
          </label>
          <label>
            最低现金
            <input
              data-testid="min-cash-input"
              max={1}
              min={0}
              step={0.01}
              type="number"
              value={config.risk.minCashWeight ?? 0}
              onChange={(event) =>
                onChange({
                  ...config,
                  risk: {
                    ...config.risk,
                    minCashWeight: boundedNumber(
                      Number(event.target.value),
                      config.risk.minCashWeight ?? 0,
                      0,
                      1
                    )
                  }
                })
              }
            />
          </label>
          <label>
            成交额过滤
            <input
              max={1_000_000_000}
              min={0}
              step={10_000_000}
              type="range"
              value={liquidityFilter?.value ?? 0}
              onChange={(event) =>
                onChange(
                  updateLiquidityFilter(
                    config,
                    boundedNumber(
                      Number(event.target.value),
                      liquidityFilter?.value ?? 0,
                      0,
                      1_000_000_000
                    )
                  )
                )
              }
            />
            <small>{((liquidityFilter?.value ?? 0) / 100_000_000).toFixed(1)} 亿</small>
          </label>
          <label>
            空仓替代
            <select
              data-testid="cash-replacement-select"
              value={config.risk.cashReplacementSymbol ?? ""}
              onChange={(event) =>
                onChange({
                  ...config,
                  risk: {
                    ...config.risk,
                    cashReplacementSymbol: event.target.value || undefined
                  }
                })
              }
            >
              <option value="">保持现金</option>
              {profiles.map((profile) => (
                <option key={profile.symbol} value={profile.symbol}>
                  {profile.symbol} · {profile.name}
                </option>
              ))}
              {config.risk.cashReplacementSymbol &&
                !profiles.some(
                  (profile) => profile.symbol === config.risk.cashReplacementSymbol
                ) && (
                  <option value={config.risk.cashReplacementSymbol}>
                    {config.risk.cashReplacementSymbol}
                  </option>
                )}
            </select>
          </label>
        </div>
        {config.portfolio.weighting === "fixed" && (
          <div className="fixed-weight-list">
            {fixedWeights.map((weight, index) => (
              <label key={index}>
                {`第${index + 1}名比例`}
                <input
                  max={1}
                  min={0}
                  step={0.01}
                  type="number"
                  value={weight}
                  onChange={(event) =>
                    onChange(
                      updateFixedWeight(
                        config,
                        index,
                        boundedNumber(Number(event.target.value), weight, 0, 1)
                      )
                    )
                  }
                />
                <small>{(weight * 100).toFixed(0)}%</small>
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="成交模型"
        action={<span className="section-note">T+1 · 单笔佣金 · 成交约束</span>}
      >
        <ExecutionSettingsControls config={config} onChange={onChange} />
      </Section>

      <Section
        title="ETF 池"
        action={<span className="section-note">{config.universe.length} 个已选</span>}
      >
        <label className="etf-search">
          <Search size={16} />
          <input
            aria-label="搜索 ETF"
            placeholder="输入 ETF 名称、代码、分类或跟踪指数"
            value={etfQuery}
            onChange={(event) => setEtfQuery(event.target.value)}
          />
        </label>
        <div className="universe-grid">
          {etfMatches.map((profile) => {
            const checked = config.universe.includes(profile.symbol);
            return (
              <label className={checked ? "etf-option checked" : "etf-option"} key={profile.symbol}>
                <input
                  checked={checked}
                  onChange={() => {
                    const universe = checked
                      ? config.universe.filter((symbol) => symbol !== profile.symbol)
                      : [...config.universe, profile.symbol];
                    onChange({ ...config, universe });
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.symbol} · {profile.category}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
        {etfMatches.length === 0 && (
          <div className="empty-state">没有匹配的 ETF</div>
        )}
      </Section>

      <Section
        title="因子权重与参数"
        action={
          <div className="inline-actions">
            <select value={factorToAdd} onChange={(event) => setFactorToAdd(event.target.value)}>
              {factorCatalog.map((factor) => (
                <option key={factor.id} value={factor.id}>
                  {factor.name}
                </option>
              ))}
            </select>
            <button
              className="text-action"
              data-testid="add-factor-button"
              onClick={() => onChange(addFactor(config, factorToAdd))}
              type="button"
            >
              <Plus size={16} />
              添加因子
            </button>
          </div>
        }
      >
        <div className="factor-controls factor-controls--parametric">
          {config.factors.map((factor) => {
            const definition = factorById.get(factor.id);
            const factorKey = factor.key ?? factor.id;
            return (
              <div className="factor-control factor-control--parametric" key={factorKey}>
                <label className="factor-toggle">
                  <input
                    checked={factor.enabled}
                    onChange={(event) =>
                      onChange(updateFactor(config, factorKey, { enabled: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{getFactorDisplayName(factor)}</strong>
                    <small>{factor.direction === "desc" ? "高优先" : "低优先"}</small>
                  </span>
                </label>
                <div className="inline-actions inline-actions--compact">
                  <label>
                    方向
                    <select
                      value={factor.direction}
                      onChange={(event) =>
                        onChange(
                          updateFactor(config, factorKey, {
                            direction: event.target.value as FactorDirection
                          })
                        )
                      }
                    >
                      <option value="desc">高优先</option>
                      <option value="asc">低优先</option>
                    </select>
                  </label>
                  <button
                    className="icon-action"
                    onClick={() => onChange(duplicateFactor(config, factor))}
                    title="复制因子"
                    type="button"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="icon-action danger"
                    disabled={config.factors.length <= 1}
                    onClick={() => onChange(removeFactor(config, factorKey))}
                    title="删除因子"
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <label>
                  权重
                  <input
                    max={1}
                    min={0}
                    step={0.01}
                    type="range"
                    value={factor.weight}
                    onChange={(event) =>
                      onChange(
                        updateFactor(config, factorKey, {
                          weight: boundedNumber(
                            Number(event.target.value),
                            factor.weight,
                            0,
                            1
                          )
                        })
                      )
                    }
                  />
                  <small>{(factor.weight * 100).toFixed(0)}%</small>
                </label>
                {definition?.paramSchema?.map((param) => {
                  const currentValue =
                    typeof factor.params?.[param.key] === "number"
                      ? (factor.params[param.key] as number)
                      : Number(definition.defaultParams[param.key]);
                  return (
                    <label key={param.key}>
                      {param.label}
                      <input
                        max={param.max}
                        min={param.min}
                        step={param.step}
                        type="number"
                        value={currentValue}
                        onChange={(event) =>
                          onChange(
                            updateFactorParam(
                              config,
                              factorKey,
                              param.key,
                              boundedNumber(
                                Number(event.target.value),
                                currentValue,
                                param.min,
                                param.max
                              )
                            )
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="筛选条件"
        action={
          <button
            className="text-action"
            data-testid="add-filter-button"
            onClick={() =>
              onChange({ ...config, filters: [...config.filters, createFilterRule(config.filters.length)] })
            }
            type="button"
          >
            <Plus size={16} />
            添加条件
          </button>
        }
      >
        <div className="filter-list">
          {config.filters.map((filter, index) => {
            const filterKey = filter.key ?? `${filter.factorId}-${index}`;
            const definition = factorById.get(filter.factorId);
            const currentWindow =
              typeof filter.params?.window === "number"
                ? (filter.params.window as number)
                : Number(definition?.defaultParams.window ?? 20);

            return (
              <div className="filter-row" key={filterKey}>
                <label>
                  因子
                  <select
                    value={filter.factorId}
                    onChange={(event) => {
                      const nextDefinition = factorById.get(event.target.value);
                      onChange(
                        updateFilter(config, filterKey, {
                          factorId: event.target.value,
                          params: { ...(nextDefinition?.defaultParams ?? {}) }
                        })
                      );
                    }}
                  >
                    {factorCatalog.map((factor) => (
                      <option key={factor.id} value={factor.id}>
                        {factor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  条件
                  <select
                    value={filter.operator}
                    onChange={(event) =>
                      onChange(
                        updateFilter(config, filterKey, {
                          operator: event.target.value as FilterOperator
                        })
                      )
                    }
                  >
                    <option value=">=">大于等于</option>
                    <option value=">">大于</option>
                    <option value="<=">小于等于</option>
                    <option value="<">小于</option>
                    <option value="between">区间</option>
                  </select>
                </label>
                <label>
                  数值
                  <input
                    step={0.01}
                    type="number"
                    value={filter.value}
                    onChange={(event) =>
                      onChange(
                        updateFilter(config, filterKey, {
                          value: Number(event.target.value)
                        })
                      )
                    }
                  />
                </label>
                {filter.operator === "between" && (
                  <label>
                    上限
                    <input
                      step={0.01}
                      type="number"
                      value={filter.value2 ?? filter.value}
                      onChange={(event) =>
                        onChange(
                          updateFilter(config, filterKey, {
                            value2: Number(event.target.value)
                          })
                        )
                      }
                    />
                  </label>
                )}
                {definition?.paramSchema?.map((param) => (
                  <label key={param.key}>
                    {param.label}
                    <input
                      max={param.max}
                      min={param.min}
                      step={param.step}
                      type="number"
                      value={currentWindow}
                      onChange={(event) =>
                        onChange(
                          updateFilterParam(
                            config,
                            filterKey,
                            param.key,
                            boundedNumber(
                              Number(event.target.value),
                              currentWindow,
                              param.min,
                              param.max
                            )
                          )
                        )
                      }
                    />
                  </label>
                ))}
                <button
                  className="icon-action danger"
                  onClick={() => onChange(removeFilter(config, filterKey))}
                  title="删除条件"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function CompositeStrategyEditor({
  config,
  profiles,
  strategies,
  result,
  onChange
}: {
  config: CompositeStrategyConfig;
  profiles: EtfProfile[];
  strategies: StrategyConfig[];
  result: BacktestResult;
  onChange: (config: StrategyConfig) => void;
}) {
  const bases = baseStrategies(strategies);

  return (
    <>
      <Section
        title="组合策略"
        action={<span className="section-note">累计收益 {formatPercent(result.metrics.totalReturn)}</span>}
      >
        <div className="control-grid">
          <label>
            策略名称
            <input
              value={config.name}
              onChange={(event) => onChange({ ...config, name: event.target.value })}
            />
          </label>
          <BacktestSettingsControls
            config={config}
            onChange={onChange}
            profiles={profiles}
          />
          <label>
            交易成本 bps
            <input
              max={50}
              min={0}
              type="number"
              value={config.transactionCostBps}
              onChange={(event) =>
                onChange({
                  ...config,
                  transactionCostBps: boundedNumber(
                    Number(event.target.value),
                    config.transactionCostBps,
                    0,
                    50
                  )
                })
              }
            />
          </label>
        </div>
      </Section>

      <Section
        title="组合层成交模型"
        action={<span className="section-note">组合再平衡成本</span>}
      >
        <ExecutionSettingsControls config={config} onChange={onChange} />
      </Section>

      <Section
        title="子策略权重"
        action={<span className="section-note">{config.components.length} 个已组合</span>}
      >
        <div className="component-list">
          {bases.map((strategy) => {
            const component = config.components.find(
              (item) => item.strategyId === strategy.id
            );
            return (
              <div className="component-row" key={strategy.id}>
                <label className="factor-toggle">
                  <input
                    checked={Boolean(component)}
                    onChange={(event) =>
                      onChange(upsertComponent(config, strategy.id, event.target.checked))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{strategy.name}</strong>
                    <small>{strategy.description}</small>
                  </span>
                </label>
                <label className="component-weight-control">
                  权重
                  <input
                    disabled={!component}
                    max={1}
                    min={0}
                    step={0.01}
                    type="range"
                    value={component?.weight ?? 0}
                    onChange={(event) =>
                      onChange(
                        updateComponentWeight(
                          config,
                          strategy.id,
                          boundedNumber(Number(event.target.value), component?.weight ?? 0, 0, 1)
                        )
                      )
                    }
                  />
                  <input
                    disabled={!component}
                    max={1}
                    min={0}
                    step={0.01}
                    type="number"
                    value={component?.weight ?? 0}
                    onChange={(event) =>
                      onChange(
                        updateComponentWeight(
                          config,
                          strategy.id,
                          boundedNumber(Number(event.target.value), component?.weight ?? 0, 0, 1)
                        )
                      )
                    }
                  />
                  <small>{((component?.weight ?? 0) * 100).toFixed(0)}%</small>
                </label>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

export function StrategyLab({
  config,
  result,
  profiles,
  strategies,
  activeStrategyId,
  onSelect,
  onChange,
  onCreateBase,
  onCreateComposite,
  onDuplicate,
  onDelete
}: {
  config: StrategyConfig;
  result: BacktestResult;
  profiles: EtfProfile[];
  strategies: StrategyConfig[];
  activeStrategyId: string;
  onSelect: (id: string) => void;
  onChange: (config: StrategyConfig) => void;
  onCreateBase: () => void;
  onCreateComposite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="lab-grid">
      <StrategyToolbar
        activeStrategyId={activeStrategyId}
        onCreateBase={onCreateBase}
        onCreateComposite={onCreateComposite}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onSelect={onSelect}
        strategies={strategies}
      />

      {config.kind === "composite" ? (
        <CompositeStrategyEditor
          config={config}
          onChange={onChange}
          profiles={profiles}
          result={result}
          strategies={strategies}
        />
      ) : (
        <BaseStrategyEditor
          config={config}
          onChange={onChange}
          profiles={profiles}
          result={result}
        />
      )}
    </div>
  );
}
