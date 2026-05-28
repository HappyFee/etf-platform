import { RotateCcw } from "lucide-react";
import { factorCatalog } from "../core/factors";
import type {
  BacktestResult,
  EtfProfile,
  FactorSelection,
  FilterRule,
  RebalanceFrequency,
  StrategyConfig,
  WeightingMethod
} from "../core/types";
import { formatPercent, Section } from "./ui";

function updateFactor(
  config: StrategyConfig,
  id: string,
  patch: Partial<FactorSelection>
): StrategyConfig {
  return {
    ...config,
    factors: config.factors.map((factor) =>
      factor.id === id ? { ...factor, ...patch } : factor
    )
  };
}

function updateLiquidityFilter(config: StrategyConfig, value: number): StrategyConfig {
  const nextFilter: FilterRule = {
    factorId: "amount_ma20",
    operator: ">=",
    value,
    params: { window: 20 }
  };

  const otherFilters = config.filters.filter((filter) => filter.factorId !== "amount_ma20");
  return { ...config, filters: [nextFilter, ...otherFilters] };
}

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

export function StrategyLab({
  config,
  result,
  profiles,
  onChange,
  onReset
}: {
  config: StrategyConfig;
  result: BacktestResult;
  profiles: EtfProfile[];
  onChange: (config: StrategyConfig) => void;
  onReset: () => void;
}) {
  const factorById = new Map(factorCatalog.map((factor) => [factor.id, factor]));
  const liquidityFilter = config.filters.find((filter) => filter.factorId === "amount_ma20");

  return (
    <div className="lab-grid">
      <Section
        title="组合规则"
        action={
          <button className="icon-action" onClick={onReset} title="恢复默认策略" type="button">
            <RotateCcw size={17} />
          </button>
        }
      >
        <div className="control-grid">
          <label>
            调仓频率
            <select
              value={config.rebalance.frequency}
              onChange={(event) =>
                onChange({
                  ...config,
                  rebalance: {
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
          <label>
            持仓数量
            <input
              max={6}
              min={1}
              type="number"
              value={config.portfolio.topN}
              onChange={(event) =>
                onChange({
                  ...config,
                  portfolio: {
                    ...config.portfolio,
                    topN: Math.round(
                      boundedNumber(Number(event.target.value), config.portfolio.topN, 1, 6)
                    )
                  }
                })
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
                    weighting: event.target.value as WeightingMethod
                  }
                })
              }
            >
              <option value="equal">等权</option>
              <option value="score">按得分</option>
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
      </Section>

      <Section
        title="ETF 池"
        action={<span className="section-note">{config.universe.length} 个已选</span>}
      >
        <div className="universe-grid">
          {profiles.map((profile) => {
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
      </Section>

      <Section
        title="因子权重"
        action={<span className="section-note">累计收益 {formatPercent(result.metrics.totalReturn)}</span>}
      >
        <div className="factor-controls">
          {config.factors.map((factor) => {
            const definition = factorById.get(factor.id);
            return (
              <div className="factor-control" key={factor.id}>
                <label className="factor-toggle">
                  <input
                    checked={factor.enabled}
                    onChange={(event) =>
                      onChange(updateFactor(config, factor.id, { enabled: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{definition?.name ?? factor.id}</strong>
                    <small>{factor.direction === "desc" ? "高优先" : "低优先"}</small>
                  </span>
                </label>
                <input
                  max={1}
                  min={0}
                  step={0.01}
                  type="range"
                  value={factor.weight}
                  onChange={(event) =>
                    onChange(
                      updateFactor(config, factor.id, {
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
                <b>{(factor.weight * 100).toFixed(0)}%</b>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
