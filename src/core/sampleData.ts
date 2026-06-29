import { tradingDays } from "./date";
import type { EtfProfile, MarketBar } from "./types";

interface SeedProfile extends EtfProfile {
  basePrice: number;
  baseAmount: number;
  drift: number;
  volatility: number;
}

const seedProfiles: SeedProfile[] = [
  {
    symbol: "510300",
    name: "沪深300ETF",
    exchange: "SH",
    category: "宽基",
    trackingIndex: "沪深300",
    expenseRatio: 0.005,
    basePrice: 4.1,
    baseAmount: 900_000_000,
    drift: 0.00022,
    volatility: 0.012
  },
  {
    symbol: "510500",
    name: "中证500ETF",
    exchange: "SH",
    category: "宽基",
    trackingIndex: "中证500",
    expenseRatio: 0.005,
    basePrice: 6.2,
    baseAmount: 520_000_000,
    drift: 0.00018,
    volatility: 0.015
  },
  {
    symbol: "512100",
    name: "中证1000ETF",
    exchange: "SH",
    category: "宽基",
    trackingIndex: "中证1000",
    expenseRatio: 0.006,
    basePrice: 2.1,
    baseAmount: 420_000_000,
    drift: 0.0002,
    volatility: 0.018
  },
  {
    symbol: "159915",
    name: "创业板ETF",
    exchange: "SZ",
    category: "成长",
    trackingIndex: "创业板指",
    expenseRatio: 0.005,
    basePrice: 2.3,
    baseAmount: 720_000_000,
    drift: 0.00024,
    volatility: 0.02
  },
  {
    symbol: "512880",
    name: "证券ETF",
    exchange: "SH",
    category: "行业",
    trackingIndex: "证券公司",
    expenseRatio: 0.005,
    basePrice: 0.95,
    baseAmount: 650_000_000,
    drift: 0.00016,
    volatility: 0.024
  },
  {
    symbol: "512690",
    name: "酒ETF",
    exchange: "SH",
    category: "消费",
    trackingIndex: "中证酒",
    expenseRatio: 0.005,
    basePrice: 0.82,
    baseAmount: 240_000_000,
    drift: 0.0002,
    volatility: 0.022
  },
  {
    symbol: "512010",
    name: "医药ETF",
    exchange: "SH",
    category: "行业",
    trackingIndex: "医药卫生",
    expenseRatio: 0.005,
    basePrice: 1.4,
    baseAmount: 310_000_000,
    drift: 0.00014,
    volatility: 0.018
  },
  {
    symbol: "515790",
    name: "光伏ETF",
    exchange: "SH",
    category: "新能源",
    trackingIndex: "光伏产业",
    expenseRatio: 0.005,
    basePrice: 1.15,
    baseAmount: 280_000_000,
    drift: 0.00019,
    volatility: 0.026
  },
  {
    symbol: "518880",
    name: "黄金ETF",
    exchange: "SH",
    category: "商品",
    trackingIndex: "上海金",
    expenseRatio: 0.006,
    basePrice: 4.0,
    baseAmount: 360_000_000,
    drift: 0.00012,
    volatility: 0.01
  },
  {
    symbol: "511010",
    name: "国债ETF",
    exchange: "SH",
    category: "债券",
    trackingIndex: "上证5年国债",
    expenseRatio: 0.003,
    basePrice: 124,
    baseAmount: 190_000_000,
    drift: 0.00005,
    volatility: 0.002
  },
  {
    symbol: "511880",
    name: "银华日利ETF",
    exchange: "SH",
    category: "货币",
    trackingIndex: "货币市场",
    expenseRatio: 0.003,
    basePrice: 100,
    baseAmount: 1_400_000_000,
    drift: 0.00006,
    volatility: 0.0004
  },
  {
    symbol: "159928",
    name: "消费ETF",
    exchange: "SZ",
    category: "消费",
    trackingIndex: "中证主要消费",
    expenseRatio: 0.005,
    basePrice: 0.91,
    baseAmount: 180_000_000,
    drift: 0.00017,
    volatility: 0.017
  },
  {
    symbol: "159981",
    name: "能源化工ETF",
    exchange: "SZ",
    category: "周期",
    trackingIndex: "能源化工",
    expenseRatio: 0.005,
    basePrice: 1.05,
    baseAmount: 150_000_000,
    drift: 0.00015,
    volatility: 0.019
  }
];

export const etfProfiles: EtfProfile[] = seedProfiles.map(
  ({ basePrice: _basePrice, baseAmount: _baseAmount, drift: _drift, volatility: _volatility, ...profile }) =>
    profile
);

function seedFromSymbol(symbol: string): number {
  return symbol
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);
}

function pseudoRandom(seed: number, index: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function generateBars(profile: SeedProfile): MarketBar[] {
  const dates = tradingDays("2021-01-04", "2026-05-22");
  const seed = seedFromSymbol(profile.symbol);
  let close = profile.basePrice;

  return dates.map((date, index) => {
    const cycle = Math.sin(index / 67 + seed / 17) * profile.volatility * 0.32;
    const regime = Math.sin(index / 190 + seed / 43) * profile.drift * 2.8;
    const randomShock = (pseudoRandom(seed, index) - 0.5) * profile.volatility;
    const dailyReturn = profile.drift + regime + cycle * 0.18 + randomShock;
    const previousClose = close;
    close = Math.max(0.1, close * (1 + dailyReturn));

    const intraday = (pseudoRandom(seed + 3, index) - 0.5) * profile.volatility;
    const open = Math.max(0.1, previousClose * (1 + intraday * 0.25));
    const high = Math.max(open, close) * (1 + Math.abs(intraday) * 0.45);
    const low = Math.min(open, close) * (1 - Math.abs(intraday) * 0.45);
    const liquidityPulse =
      0.82 + pseudoRandom(seed + 9, index) * 0.36 + Math.abs(dailyReturn) * 7;
    const amount = Math.max(20_000_000, profile.baseAmount * liquidityPulse);
    const volume = Math.round(amount / close / 100);

    return {
      symbol: profile.symbol,
      date,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume,
      amount: Math.round(amount)
    };
  });
}

export const marketBars: MarketBar[] = seedProfiles.flatMap(generateBars);

export function groupBarsBySymbol(bars: MarketBar[]): Map<string, MarketBar[]> {
  const grouped = new Map<string, MarketBar[]>();

  for (const bar of bars) {
    const current = grouped.get(bar.symbol) ?? [];
    current.push(bar);
    grouped.set(bar.symbol, current);
  }

  for (const [symbol, symbolBars] of grouped) {
    grouped.set(
      symbol,
      [...symbolBars].sort((left, right) => left.date.localeCompare(right.date))
    );
  }

  return grouped;
}
