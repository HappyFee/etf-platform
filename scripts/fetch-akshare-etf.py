#!/usr/bin/env python3
"""Fetch A-share ETF daily bars with akshare and write normalized JSON.

The web app works without this file because it ships deterministic demo data.
Run this script in GitHub Actions or locally when you want real ETF bars:

    python scripts/fetch-akshare-etf.py --output public/data/a-share-etf-bars.generated.json
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_SYMBOLS = [
    "510300",
    "510500",
    "512100",
    "159915",
    "512880",
    "512690",
    "512010",
    "515790",
    "518880",
    "511010",
    "159928",
    "159981",
]


PROFILE_NAMES = {
    "510300": ("沪深300ETF", "SH", "宽基", "沪深300"),
    "510500": ("中证500ETF", "SH", "宽基", "中证500"),
    "512100": ("中证1000ETF", "SH", "宽基", "中证1000"),
    "159915": ("创业板ETF", "SZ", "成长", "创业板指"),
    "512880": ("证券ETF", "SH", "行业", "证券公司"),
    "512690": ("酒ETF", "SH", "消费", "中证酒"),
    "512010": ("医药ETF", "SH", "行业", "医药卫生"),
    "515790": ("光伏ETF", "SH", "新能源", "光伏产业"),
    "518880": ("黄金ETF", "SH", "商品", "上海金"),
    "511010": ("国债ETF", "SH", "债券", "上证5年国债"),
    "159928": ("消费ETF", "SZ", "消费", "中证主要消费"),
    "159981": ("能源化工ETF", "SZ", "周期", "能源化工"),
}


@dataclass
class EtfProfile:
    symbol: str
    name: str
    exchange: str
    category: str
    trackingIndex: str
    expenseRatio: float = 0.005


@dataclass
class MarketBar:
    symbol: str
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    amount: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", nargs="*", default=DEFAULT_SYMBOLS)
    parser.add_argument("--start", default="20210101")
    parser.add_argument("--end", default=date.today().strftime("%Y%m%d"))
    parser.add_argument("--adjust", default="qfq", choices=["", "qfq", "hfq"])
    parser.add_argument(
        "--output",
        default="public/data/a-share-etf-bars.generated.json",
        help="Path to normalized output JSON.",
    )
    return parser.parse_args()


def build_profiles(symbols: Iterable[str]) -> list[EtfProfile]:
    profiles: list[EtfProfile] = []
    for symbol in symbols:
        name, exchange, category, tracking_index = PROFILE_NAMES.get(
            symbol, (symbol, "SH" if symbol.startswith("5") else "SZ", "ETF", symbol)
        )
        profiles.append(
            EtfProfile(
                symbol=symbol,
                name=name,
                exchange=exchange,
                category=category,
                trackingIndex=tracking_index,
            )
        )
    return profiles


def fetch_symbol(symbol: str, start: str, end: str, adjust: str) -> list[MarketBar]:
    try:
        import akshare as ak  # type: ignore
    except ImportError as exc:
        raise SystemExit("akshare is required: pip install akshare pandas") from exc

    frame = ak.fund_etf_hist_em(
        symbol=symbol,
        period="daily",
        start_date=start,
        end_date=end,
        adjust=adjust,
    )

    column_map = {
        "日期": "date",
        "开盘": "open",
        "最高": "high",
        "最低": "low",
        "收盘": "close",
        "成交量": "volume",
        "成交额": "amount",
    }
    missing = [column for column in column_map if column not in frame.columns]
    if missing:
        raise ValueError(f"{symbol} missing expected columns: {missing}")

    bars: list[MarketBar] = []
    for record in frame.to_dict("records"):
        bars.append(
            MarketBar(
                symbol=symbol,
                date=str(record["日期"])[:10],
                open=float(record["开盘"]),
                high=float(record["最高"]),
                low=float(record["最低"]),
                close=float(record["收盘"]),
                volume=int(record["成交量"]),
                amount=int(record["成交额"]),
            )
        )

    return sorted(bars, key=lambda item: item.date)


def main() -> None:
    args = parse_args()
    bars: list[MarketBar] = []

    for symbol in args.symbols:
        symbol_bars = fetch_symbol(symbol, args.start, args.end, args.adjust)
        if not symbol_bars:
            raise ValueError(f"{symbol} returned no bars")
        bars.extend(symbol_bars)

    payload = {
        "source": "akshare.fund_etf_hist_em",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "profiles": [asdict(profile) for profile in build_profiles(args.symbols)],
        "bars": [asdict(bar) for bar in bars],
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(bars)} bars to {output}")


if __name__ == "__main__":
    main()
