import type { ReactNode } from "react";
import type { Holding } from "../core/types";

export function withCashHolding(holdings: Holding[]): Holding[] {
  const investedWeight = holdings.reduce(
    (total, holding) => total + Math.max(0, holding.weight),
    0
  );
  const cashWeight = Math.max(0, 1 - investedWeight);

  if (cashWeight <= 0.0001) {
    return holdings;
  }

  return [
    ...holdings,
    {
      symbol: "CASH",
      name: "现金",
      weight: cashWeight
    }
  ];
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toFixed(digits);
}

export function formatAmount(value: number): string {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}亿`;
  }
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(0)}万`;
  }
  return value.toFixed(0);
}

export function MetricTile({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  return (
    <div className={`metric-tile metric-tile--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Section({
  title,
  action,
  children
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section-block">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
