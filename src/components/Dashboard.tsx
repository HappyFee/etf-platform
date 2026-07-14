import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import type {
  BacktestResult,
  DataQualityReport,
  RobustnessReport,
  StrategyConfig,
  ValidationReport
} from "../core/types";
import { formatAmount, formatNumber, formatPercent, MetricTile, Section } from "./ui";
import { SignalPanel } from "./SignalPanel";

function strategySummary(config: StrategyConfig, rebalanceCount: number): string {
  if (config.kind === "composite") {
    return `组合策略 · ${config.components.length} 个子策略`;
  }
  const rebalanceLabel =
    config.rebalance.frequency === "daily"
      ? "每日调仓"
      : config.rebalance.frequency === "weekly"
        ? `每周${["", "一", "二", "三", "四", "五"][config.rebalance.weeklyDay ?? 1]}调仓`
        : `每月${config.rebalance.monthlyDay ?? 1}日调仓`;
  return `${rebalanceLabel} · Top ${config.portfolio.topN} · ${rebalanceCount} 次成交`;
}

function backtestRange(result: BacktestResult): string {
  const firstDate = result.equityCurve[0]?.date;
  const latestDate = result.equityCurve.at(-1)?.date;
  return firstDate && latestDate ? `${firstDate} 至 ${latestDate}` : "暂无有效区间";
}

function optionalPercent(value: number | undefined): string {
  return value === undefined ? "--" : formatPercent(value);
}

function optionalNumber(value: number | undefined): string {
  return value === undefined ? "--" : formatNumber(value);
}

function validationStatusLabel(status: ValidationReport["status"]): string {
  return status === "stable"
    ? "稳定"
    : status === "mixed"
      ? "需观察"
      : status === "weak"
        ? "偏弱"
        : "数据不足";
}

export function Dashboard({
  result,
  config,
  dataQuality,
  robustness,
  validation,
  archive,
  children
}: {
  result: BacktestResult;
  config: StrategyConfig;
  dataQuality: DataQualityReport;
  robustness: RobustnessReport;
  validation: ValidationReport;
  archive: ReactNode;
  children: ReactNode;
}) {
  const { metrics } = result;
  const qualityRows = dataQuality.symbols
    .slice()
    .sort((left, right) => left.coverageRatio - right.coverageRatio)
    .slice(0, 6);
  const constrainedRebalances = result.rebalances.filter(
    (event) => (event.constraintCount ?? 0) > 0
  ).length;
  const averageFillRate =
    result.rebalances.length === 0
      ? 1
      : result.rebalances.reduce(
          (total, event) => total + (event.fillRate ?? 1),
          0
        ) / result.rebalances.length;
  const totalCommission = result.rebalances.reduce(
    (total, event) => total + (event.commissionAmount ?? 0),
    0
  );

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
        <MetricTile
          label="超额年化"
          value={formatPercent(metrics.excessAnnualizedReturn ?? 0)}
          tone={(metrics.excessAnnualizedReturn ?? 0) >= 0 ? "good" : "bad"}
        />
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

      <div className="diagnostic-grid">
        <Section title="回测口径" action={<span className="section-note">{backtestRange(result)}</span>}>
          <div className="assumption-list">
            <span>口径：信号与成交分离</span>
            <span>信号：调仓日收盘后生成</span>
            <span>成交：下一交易日收盘切仓</span>
            <span>
              成本：手续费 {config.transactionCostBps} bps + 滑点{" "}
              {config.execution?.slippageBps ?? 3} bps
            </span>
            <span>
              资金：{formatAmount(config.execution?.initialCapital ?? 100_000)}元 · 最低佣金{" "}
              {config.execution?.minimumCommission ?? (config.kind === "composite" ? 0 : 5)}元
            </span>
            <span>
              约束：成交占比 {formatPercent(config.execution?.maxParticipationRate ?? 0.1)} ·
              涨跌停 {formatPercent(config.execution?.priceLimitThreshold ?? 0.1)}
            </span>
            <span>缺失行情：该持仓按现金收益处理</span>
          </div>
        </Section>

        <Section
          title="基准对比"
          action={<span className="section-note">{result.benchmark?.name ?? "ETF池等权基准"}</span>}
        >
          <div className="compact-metrics">
            <span>
              <small>基准累计</small>
              <strong>{optionalPercent(metrics.benchmarkTotalReturn)}</strong>
            </span>
            <span>
              <small>信息比率</small>
              <strong>{optionalNumber(metrics.informationRatio)}</strong>
            </span>
            <span>
              <small>平均换手</small>
              <strong>{formatPercent(metrics.averageTurnover)}</strong>
            </span>
          </div>
        </Section>

        <Section title="成交质量" action={<span className="section-note">实际成交回放</span>}>
          <div className="compact-metrics">
            <span>
              <small>累计佣金</small>
              <strong>{formatAmount(totalCommission)}元</strong>
            </span>
            <span>
              <small>平均成交率</small>
              <strong>{formatPercent(averageFillRate)}</strong>
            </span>
            <span>
              <small>受限调仓</small>
              <strong>{constrainedRebalances}</strong>
            </span>
          </div>
        </Section>
      </div>

      <Section
        title="样本外验证"
        action={
          <span className={`validation-status validation-status--${validation.status}`}>
            {validationStatusLabel(validation.status)}
          </span>
        }
      >
        <div className="validation-layout">
          <div className="validation-periods">
            <div className="validation-period">
              <span>样本内 70%</span>
              <strong>{optionalPercent(validation.inSample?.annualizedReturn)}</strong>
              <small>
                {validation.inSample
                  ? `${validation.inSample.startDate} 至 ${validation.inSample.endDate} · Sharpe ${formatNumber(validation.inSample.sharpe)} · 回撤 ${formatPercent(validation.inSample.maxDrawdown)}`
                  : "暂无有效区间"}
              </small>
            </div>
            <div className="validation-period">
              <span>样本外 30%</span>
              <strong>{optionalPercent(validation.outOfSample?.annualizedReturn)}</strong>
              <small>
                {validation.outOfSample
                  ? `${validation.outOfSample.startDate} 至 ${validation.outOfSample.endDate} · Sharpe ${formatNumber(validation.outOfSample.sharpe)} · 回撤 ${formatPercent(validation.outOfSample.maxDrawdown)}`
                  : "暂无有效区间"}
              </small>
            </div>
          </div>
          <div className="validation-checks">
            {validation.checks.map((check) => {
              const Icon = check.status === "pass" ? CheckCircle2 : AlertTriangle;
              return (
                <div className={`validation-check validation-check--${check.status}`} key={check.label}>
                  <Icon size={17} />
                  <span>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="validation-summary">{validation.summary}</p>
      </Section>

      {archive}

      <Section
        title="数据质量"
        action={<span className="section-note">最近 {dataQuality.latestDate}</span>}
      >
        <div className="quality-summary">
          <span>{dataQuality.symbolCount} 只 ETF</span>
          <span>{dataQuality.staleSymbols.length} 只滞后</span>
          <span>{dataQuality.estimatedAmountSymbols.length} 只成交额疑似估算</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ETF</th>
                <th>最新日期</th>
                <th>覆盖率</th>
                <th>缺失日</th>
                <th>平均成交额</th>
                <th>提示</th>
              </tr>
            </thead>
            <tbody>
              {qualityRows.map((item) => (
                <tr key={item.symbol}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.symbol}</small>
                  </td>
                  <td>{item.latestDate}</td>
                  <td>{formatPercent(item.coverageRatio)}</td>
                  <td>{item.missingDays}</td>
                  <td>{formatAmount(item.averageAmount)}</td>
                  <td>{item.warnings.join("、") || "正常"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="稳健性压力" action={<span className="section-note">{robustness.summary}</span>}>
        <div className="robustness-grid">
          {robustness.cases.map((item) => (
            <div className="robustness-card" key={item.name}>
              <span>{item.name}</span>
              <strong>{formatPercent(item.totalReturn)}</strong>
              <small>
                年化 {formatPercent(item.annualizedReturn)} / 回撤{" "}
                {formatPercent(item.maxDrawdown)} / Sharpe {formatNumber(item.sharpe)}
              </small>
            </div>
          ))}
        </div>
      </Section>

      <SignalPanel result={result} compact />
    </div>
  );
}
