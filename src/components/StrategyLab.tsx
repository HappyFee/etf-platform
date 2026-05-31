import { Copy, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { factorCatalog, getFactorDisplayName } from "../core/factors";
import type {
  BacktestResult,
  BaseStrategyConfig,
  CompositeStrategyConfig,
  EtfProfile,
  FactorSelection,
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

function updateFactor(
  config: BaseStrategyConfig,
  key: string,
  patch: Partial<FactorSelection>
): BaseStrategyConfig {
  return {
    ...config,
    factors: config.factors.map((factor) =>
      factor.key === key ? { ...factor, ...patch } : factor
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
      factor.key === key
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

function updateLiquidityFilter(config: BaseStrategyConfig, value: number): BaseStrategyConfig {
  const nextFilter: FilterRule = {
    factorId: "amount_ma",
    operator: ">=",
    value,
    params: { window: 20 }
  };

  const otherFilters = config.filters.filter((filter) => filter.factorId !== "amount_ma");
  return { ...config, filters: [nextFilter, ...otherFilters] };
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
        title="ETF 池"
        action={<span className="section-note">{config.universe.length} 个已选</span>}
      >
        <label className="etf-search">
          <Search size={16} />
          <input
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
        action={<span className="section-note">累计收益 {formatPercent(result.metrics.totalReturn)}</span>}
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
    </>
  );
}

function CompositeStrategyEditor({
  config,
  strategies,
  result,
  onChange
}: {
  config: CompositeStrategyConfig;
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
