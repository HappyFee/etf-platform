import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { BacktestResult } from "../core/types";
import { EmptyState, formatPercent, Section, withCashHolding } from "./ui";

export function SignalPanel({
  result,
  compact = false
}: {
  result: BacktestResult;
  compact?: boolean;
}) {
  const topRankings = result.latestSignal.rankings.slice(0, compact ? 6 : 12);
  const displayHoldings = result.latestSignal.date
    ? withCashHolding(result.latestSignal.holdings)
    : [];

  return (
    <Section
      title={compact ? "最新信号" : "信号跟踪"}
      action={<span className="section-note">{result.latestSignal.date}</span>}
    >
      <div className="signal-layout">
        <div className="holdings-panel">
          <h3>当前持仓</h3>
          {displayHoldings.length === 0 ? (
            <EmptyState>当前策略为空仓。</EmptyState>
          ) : (
            <div className="holding-list">
              {displayHoldings.map((holding) => (
                <div className="holding-row" key={holding.symbol}>
                  <span>
                    <strong>{holding.name}</strong>
                    <small>{holding.symbol}</small>
                  </span>
                  <b>{formatPercent(holding.weight, 0)}</b>
                </div>
              ))}
            </div>
          )}
          <div className="next-rebalance">
            <CheckCircle2 size={16} />
            {result.latestSignal.nextRebalanceHint}
          </div>
        </div>

        <div className="ranking-panel">
          <h3>候选排名</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>ETF</th>
                  <th>类别</th>
                  <th>得分</th>
                </tr>
              </thead>
              <tbody>
                {topRankings.map((row, index) => (
                  <tr key={row.symbol}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.symbol}</small>
                    </td>
                    <td>{row.category}</td>
                    <td>{row.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <div className="warning-list">
          {result.warnings.slice(0, 4).map((warning) => (
            <span key={warning}>
              <AlertTriangle size={15} />
              {warning}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}
