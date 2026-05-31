import type { RebalanceConfig } from "./types";

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

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function dayOfMonth(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDate();
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value as number)));
}

function scheduledDateForPeriod(
  periodDates: string[],
  targetDay: number,
  getDay: (date: string) => number
): string | null {
  if (periodDates.length === 0) {
    return null;
  }

  return (
    periodDates.find((date) => getDay(date) >= targetDay) ??
    periodDates.at(-1) ??
    null
  );
}

function currentPeriodDates(
  dates: string[],
  index: number,
  key: (date: string) => string
): string[] {
  const currentDate = dates[index];
  if (!currentDate) {
    return [];
  }

  const currentKey = key(currentDate);
  let start = index;
  let end = index;

  while (start > 0 && key(dates[start - 1]) === currentKey) {
    start -= 1;
  }

  while (end < dates.length - 1 && key(dates[end + 1]) === currentKey) {
    end += 1;
  }

  return dates.slice(start, end + 1);
}

export function shouldRebalance(
  dates: string[],
  index: number,
  config: RebalanceConfig,
  hasHoldings: boolean
): boolean {
  if (!hasHoldings) {
    return true;
  }

  if (config.frequency === "daily") {
    return true;
  }

  const current = dates[index];
  if (!current) {
    return false;
  }

  if (config.frequency === "weekly") {
    const targetDay = boundedInteger(config.weeklyDay, 1, 1, 5);
    const periodDates = currentPeriodDates(dates, index, weekKey);
    return current === scheduledDateForPeriod(periodDates, targetDay, dayOfWeek);
  }

  const targetDay = boundedInteger(config.monthlyDay, 1, 1, 31);
  const periodDates = currentPeriodDates(dates, index, monthKey);
  return current === scheduledDateForPeriod(periodDates, targetDay, dayOfMonth);
}

export function nextRebalanceHint(config: RebalanceConfig): string {
  if (config.frequency === "daily") {
    return "下一个交易日";
  }

  if (config.frequency === "weekly") {
    const labels = ["", "周一", "周二", "周三", "周四", "周五"];
    const day = boundedInteger(config.weeklyDay, 1, 1, 5);
    return `每${labels[day]}调仓，遇非交易日顺延到同周下一交易日；若无下一交易日则用同周最后交易日`;
  }

  const day = boundedInteger(config.monthlyDay, 1, 1, 31);
  return `每月${day}日调仓，遇非交易日顺延到当月下一交易日；若无下一交易日则用当月最后交易日`;
}
