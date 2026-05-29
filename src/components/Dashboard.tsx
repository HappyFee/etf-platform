import type { ReactNode } from "react";
import type { BacktestResult, StrategyConfig } from "../core/types";
import { formatNumber, formatPercent, MetricTile, Section } from "./ui";
import { SignalPanel } from "./SignalPanel";

function strategySummary(config: StrategyConfig, rebalanceCount: number): string {
  if (config.kind === "composite") {
    return `组合策略 · ${config.components.length} 个子策略`;
  }
  return `${config.rebalance.frequency} · Top ${config.portfolio.topN} · ${rebalanceCount} 次调仓`;
}

export function Dashboard({
  result,
  config,
  children
}: {
  result: BacktestResult;
  config: StrategyConfig;
  children: ReactNode;
}) {
  const { metrics } = result;

  return (
    <div className="dashboard-layout">
      <section className="metric-grid" aria-label="核心指标">
        <MetricTile
          label="累计收益"
          value={formatPercent(metrics.totalReturn)}
          tone={metrics.totalReturn >= 0 ? "good" : "bad"}
        />
        <MetricTile
          label="年化收益"
          value={formatPercent(metrics.annualizedReturn)}
          tone={metrics.annualizedReturn >= 0 ? "good" : "bad"}
        />
        <MetricTile
          label="最大回撤"
          value={formatPercent(metrics.maxDrawdown)}
          tone={metrics.maxDrawdown > 0.2 ? "bad" : "warn"}
        />
        <MetricTile label="Sharpe" value={formatNumber(metrics.sharpe)} />
        <MetricTile label="Calmar" value={formatNumber(metrics.calmar)} />
        <MetricTile
          label="胜率"
          value={formatPercent(metrics.winRate)}
          tone={metrics.winRate > 0.5 ? "good" : "neutral"}
        />
      </section>

      <Section
        title="回测报告"
        action={
          <span className="section-note">
            {strategySummary(config, metrics.rebalanceCount)}
          </span>
        }
      >
        {children}
      </Section>

      <SignalPanel result={result} compact />
    </div>
  );
}
