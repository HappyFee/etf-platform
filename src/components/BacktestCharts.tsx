import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { BacktestResult } from "../core/types";
import { formatPercent, withCashHolding } from "./ui";

const palette = ["#0f766e", "#2f6fbb", "#b7791f", "#1b7f47", "#8a4f7d"];

export function BacktestCharts({ result }: { result: BacktestResult }) {
  const equityData = result.equityCurve.map((point) => ({
    date: point.date,
    equity: Number(point.equity.toFixed(4)),
    benchmark: point.benchmarkEquity ? Number(point.benchmarkEquity.toFixed(4)) : undefined,
    drawdown: Number((-point.drawdown * 100).toFixed(2))
  }));

  const displayHoldings = result.latestSignal.date
    ? withCashHolding(result.latestSignal.holdings)
    : [];
  const allocationData = displayHoldings.map((holding, index) => ({
    name: holding.name,
    weight: Number((holding.weight * 100).toFixed(2)),
    color: palette[index % palette.length]
  }));

  return (
    <div className="chart-grid">
      <div className="chart-panel chart-panel--wide">
        <div className="chart-title">净值曲线</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={equityData}>
            <CartesianGrid stroke="#e4ecef" vertical={false} />
            <XAxis dataKey="date" minTickGap={42} tick={{ fontSize: 12 }} />
            <YAxis
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 12 }}
              width={44}
            />
            <Legend
              align="right"
              height={28}
              iconType="plainline"
              verticalAlign="top"
              wrapperStyle={{ fontSize: 12 }}
            />
            <Tooltip formatter={(value) => formatPercent(Number(value) - 1, 1)} />
            <Line
              type="monotone"
              dataKey="equity"
              name="策略净值"
              stroke="#0f766e"
              strokeWidth={2.4}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              name={result.benchmark?.name ?? "对比基准"}
              stroke="#8a4f7d"
              strokeWidth={1.8}
              strokeDasharray="5 5"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-panel">
        <div className="chart-title">回撤</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={equityData}>
            <CartesianGrid stroke="#e4ecef" vertical={false} />
            <XAxis dataKey="date" minTickGap={50} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={42} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
            <Area
              dataKey="drawdown"
              fill="#d15c4f"
              fillOpacity={0.22}
              stroke="#b83232"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-panel">
        <div className="chart-title">当前仓位</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={allocationData} layout="vertical">
            <CartesianGrid stroke="#e4ecef" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fontSize: 12 }}
              width={78}
            />
            <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
            <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
              {allocationData.map((item) => (
                <Cell key={item.name} fill={item.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
