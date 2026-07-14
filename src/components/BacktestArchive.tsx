import { FileJson, FileSpreadsheet, Save, Trash2 } from "lucide-react";
import type { BacktestSnapshot } from "../core/types";
import { EmptyState, formatNumber, formatPercent, Section } from "./ui";

export type BacktestExportFormat = "json" | "csv";

function snapshotRange(snapshot: BacktestSnapshot): string {
  const startDate = snapshot.equityCurve[0]?.date;
  const endDate = snapshot.equityCurve.at(-1)?.date;
  return startDate && endDate ? `${startDate} 至 ${endDate}` : "暂无区间";
}

function snapshotTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

export function BacktestArchive({
  snapshots,
  onSave,
  onExportCurrent,
  onExportSnapshot,
  onDelete
}: {
  snapshots: BacktestSnapshot[];
  onSave: () => void;
  onExportCurrent: (format: BacktestExportFormat) => void;
  onExportSnapshot: (snapshot: BacktestSnapshot, format: BacktestExportFormat) => void;
  onDelete: (snapshotId: string) => void;
}) {
  return (
    <Section
      title="回测档案"
      action={
        <div className="archive-actions">
          <button className="text-action" onClick={onSave} type="button">
            <Save size={16} /> 保存快照
          </button>
          <button
            className="text-action"
            onClick={() => onExportCurrent("json")}
            type="button"
          >
            <FileJson size={16} /> JSON
          </button>
          <button
            className="text-action"
            onClick={() => onExportCurrent("csv")}
            type="button"
          >
            <FileSpreadsheet size={16} /> CSV
          </button>
        </div>
      }
    >
      {snapshots.length === 0 ? (
        <EmptyState>尚未保存回测快照</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="archive-table">
            <thead>
              <tr>
                <th>策略</th>
                <th>保存时间</th>
                <th>回测区间</th>
                <th>累计收益</th>
                <th>年化收益</th>
                <th>最大回撤</th>
                <th>Sharpe</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>
                    <strong>{snapshot.strategyName}</strong>
                    <small>{snapshot.dataLatestDate}</small>
                  </td>
                  <td>{snapshotTime(snapshot.createdAt)}</td>
                  <td>{snapshotRange(snapshot)}</td>
                  <td>{formatPercent(snapshot.metrics.totalReturn)}</td>
                  <td>{formatPercent(snapshot.metrics.annualizedReturn)}</td>
                  <td>{formatPercent(snapshot.metrics.maxDrawdown)}</td>
                  <td>{formatNumber(snapshot.metrics.sharpe)}</td>
                  <td>
                    <div className="archive-row-actions">
                      <button
                        aria-label={`导出 ${snapshot.strategyName} JSON`}
                        className="icon-action"
                        onClick={() => onExportSnapshot(snapshot, "json")}
                        title="导出 JSON"
                        type="button"
                      >
                        <FileJson size={16} />
                      </button>
                      <button
                        aria-label={`导出 ${snapshot.strategyName} CSV`}
                        className="icon-action"
                        onClick={() => onExportSnapshot(snapshot, "csv")}
                        title="导出 CSV"
                        type="button"
                      >
                        <FileSpreadsheet size={16} />
                      </button>
                      <button
                        aria-label={`删除 ${snapshot.strategyName} 快照`}
                        className="icon-action danger"
                        onClick={() => onDelete(snapshot.id)}
                        title="删除快照"
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
