import type { RebalanceFrequency } from "./types";

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function tradingDays(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);

  while (current <= last) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(toIsoDate(current));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function weekKey(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const firstDay = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const diffDays = Math.floor(
    (parsed.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000)
  );
  const week = Math.floor((diffDays + firstDay.getUTCDay()) / 7);
  return `${parsed.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function shouldRebalance(
  dates: string[],
  index: number,
  frequency: RebalanceFrequency,
  hasHoldings: boolean
): boolean {
  if (!hasHoldings) {
    return true;
  }

  if (frequency === "daily") {
    return true;
  }

  const previous = dates[index - 1];
  const current = dates[index];

  if (!previous) {
    return true;
  }

  if (frequency === "weekly") {
    return weekKey(previous) !== weekKey(current);
  }

  return monthKey(previous) !== monthKey(current);
}
