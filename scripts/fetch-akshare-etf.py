#!/usr/bin/env python3
"""Fetch A-share ETF daily bars with akshare and write normalized JSON.

The web app works without this file because it ships deterministic demo data.
Run this script in GitHub Actions or locally when you want real ETF bars:

    python scripts/fetch-akshare-etf.py --output public/data/a-share-etf-bars.generated.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
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
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--retry-sleep", type=float, default=2)
    parser.add_argument("--min-success-ratio", type=float, default=0.8)
    parser.add_argument(
        "--output",
        default="public/data/a-share-etf-bars.generated.json",
        help="Path to normalized output JSON.",
    )
    return parser.parse_args()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


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


def fetch_symbol_with_retry(
    symbol: str,
    start: str,
    end: str,
    adjust: str,
    retries: int,
    retry_sleep: float,
) -> list[MarketBar]:
    attempts = max(1, retries + 1)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            bars = fetch_symbol(symbol, start, end, adjust)
            if not bars:
                raise ValueError(f"{symbol} returned no bars")
            log(f"{symbol}: fetched {len(bars)} bars through {bars[-1].date}")
            return bars
        except Exception as exc:  # noqa: BLE001 - CLI should report all provider failures.
            last_error = exc
            log(f"{symbol}: attempt {attempt}/{attempts} failed: {exc}")
            if attempt < attempts:
                time.sleep(retry_sleep)

    raise ValueError(f"{symbol} failed after {attempts} attempts: {last_error}")


def main() -> None:
    args = parse_args()
    bars: list[MarketBar] = []
    succeeded_symbols: list[str] = []
    failed_symbols: dict[str, str] = {}

    for symbol in args.symbols:
        try:
            symbol_bars = fetch_symbol_with_retry(
                symbol,
                args.start,
                args.end,
                args.adjust,
                args.retries,
                args.retry_sleep,
            )
            bars.extend(symbol_bars)
            succeeded_symbols.append(symbol)
        except Exception as exc:  # noqa: BLE001 - keep one bad ETF from blocking all data.
            failed_symbols[symbol] = str(exc)

    success_ratio = len(succeeded_symbols) / max(1, len(args.symbols))
    if not bars or success_ratio < args.min_success_ratio:
        raise SystemExit(
            "ETF data refresh failed: "
            f"{len(succeeded_symbols)}/{len(args.symbols)} symbols succeeded; "
            f"failed={failed_symbols}"
        )

    latest_date = max(bar.date for bar in bars)
    earliest_date = min(bar.date for bar in bars)

    payload = {
        "source": "akshare.fund_etf_hist_em",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "startDate": earliest_date,
        "endDate": latest_date,
        "latestDate": latest_date,
        "requestedSymbols": list(args.symbols),
        "succeededSymbols": succeeded_symbols,
        "failedSymbols": failed_symbols,
        "profiles": [asdict(profile) for profile in build_profiles(succeeded_symbols)],
        "bars": [asdict(bar) for bar in bars],
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"wrote {len(bars)} bars for {len(succeeded_symbols)}/{len(args.symbols)} "
        f"symbols through {latest_date} to {output}"
    )


if __name__ == "__main__":
    main()
