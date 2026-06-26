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
    parser.add_argument("--symbol-sleep", type=float, default=1.5)
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


def eastmoney_fqt(adjust: str) -> str:
    return {"": "0", "qfq": "1", "hfq": "2"}[adjust]


def eastmoney_secid(symbol: str) -> str:
    market = "1" if symbol.startswith("5") else "0"
    return f"{market}.{symbol}"


def exchange_symbol(symbol: str) -> str:
    return f"sh{symbol}" if symbol.startswith("5") else f"sz{symbol}"


def yahoo_symbol(symbol: str) -> str:
    suffix = "SS" if symbol.startswith("5") else "SZ"
    return f"{symbol}.{suffix}"


def fetch_symbol_from_eastmoney(symbol: str, start: str, end: str, adjust: str) -> list[MarketBar]:
    try:
        from curl_cffi import requests  # type: ignore
    except ImportError as exc:
        raise RuntimeError("curl_cffi is required for EastMoney fallback") from exc

    response = requests.get(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        params={
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
            "ut": "7eea3edcaed734bea9cbfc24409ed989",
            "klt": "101",
            "fqt": eastmoney_fqt(adjust),
            "beg": start,
            "end": end,
            "secid": eastmoney_secid(symbol),
        },
        impersonate="chrome120",
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("rc") != 0 or not payload.get("data"):
        raise ValueError(f"{symbol} EastMoney returned rc={payload.get('rc')}")

    klines = payload["data"].get("klines") or []
    bars: list[MarketBar] = []
    for line in klines:
        fields = str(line).split(",")
        if len(fields) < 7:
            continue
        bars.append(
            MarketBar(
                symbol=symbol,
                date=fields[0],
                open=float(fields[1]),
                close=float(fields[2]),
                high=float(fields[3]),
                low=float(fields[4]),
                volume=int(float(fields[5])),
                amount=int(float(fields[6])),
            )
        )

    return sorted(bars, key=lambda item: item.date)


def fetch_symbol_from_sina(symbol: str, start: str, end: str) -> list[MarketBar]:
    try:
        import akshare as ak  # type: ignore
    except ImportError as exc:
        raise RuntimeError("akshare is required for Sina fallback") from exc

    frame = ak.fund_etf_hist_sina(symbol=exchange_symbol(symbol))
    if frame.empty:
        raise ValueError(f"{symbol} Sina returned no bars")

    required_columns = ["date", "open", "high", "low", "close", "volume", "amount"]
    missing = [column for column in required_columns if column not in frame.columns]
    if missing:
        raise ValueError(f"{symbol} Sina missing expected columns: {missing}")

    bars: list[MarketBar] = []
    start_iso = f"{start[:4]}-{start[4:6]}-{start[6:8]}"
    end_iso = f"{end[:4]}-{end[4:6]}-{end[6:8]}"
    for record in frame.to_dict("records"):
        bar_date = str(record["date"])[:10]
        if bar_date < start_iso or bar_date > end_iso:
            continue
        bars.append(
            MarketBar(
                symbol=symbol,
                date=bar_date,
                open=float(record["open"]),
                high=float(record["high"]),
                low=float(record["low"]),
                close=float(record["close"]),
                volume=int(float(record["volume"])),
                amount=int(float(record["amount"])),
            )
        )

    return sorted(bars, key=lambda item: item.date)


def yyyymmdd_to_epoch(value: str) -> int:
    parsed = datetime(
        int(value[:4]),
        int(value[4:6]),
        int(value[6:8]),
        tzinfo=timezone.utc,
    )
    return int(parsed.timestamp())


def value_at(values: list[object], index: int, default: object = None) -> object:
    if index >= len(values):
        return default
    return values[index]


def fetch_symbol_from_yahoo(symbol: str, start: str, end: str) -> list[MarketBar]:
    try:
        from curl_cffi import requests  # type: ignore
    except ImportError as exc:
        raise RuntimeError("curl_cffi is required for Yahoo fallback") from exc

    response = requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol(symbol)}",
        params={
            "period1": yyyymmdd_to_epoch(start),
            "period2": yyyymmdd_to_epoch(end) + 24 * 60 * 60,
            "interval": "1d",
            "events": "history",
        },
        impersonate="chrome120",
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise ValueError(f"{symbol} Yahoo returned no result")

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [None])[0]
    if not timestamps or not quote:
        raise ValueError(f"{symbol} Yahoo returned no daily quote")

    bars: list[MarketBar] = []
    for index, timestamp in enumerate(timestamps):
        open_price = value_at(quote.get("open") or [], index)
        high = value_at(quote.get("high") or [], index)
        low = value_at(quote.get("low") or [], index)
        close = value_at(quote.get("close") or [], index)
        volume = value_at(quote.get("volume") or [], index, 0) or 0
        if open_price is None or high is None or low is None or close is None:
            continue
        bars.append(
            MarketBar(
                symbol=symbol,
                date=datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat(),
                open=float(open_price),
                high=float(high),
                low=float(low),
                close=float(close),
                volume=int(volume),
                amount=int(float(volume) * float(close)),
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
            log(f"{symbol}: akshare attempt {attempt}/{attempts} failed: {exc}")
            try:
                bars = fetch_symbol_from_eastmoney(symbol, start, end, adjust)
                if not bars:
                    raise ValueError(f"{symbol} EastMoney fallback returned no bars")
                log(f"{symbol}: EastMoney fallback fetched {len(bars)} bars through {bars[-1].date}")
                return bars
            except Exception as fallback_exc:  # noqa: BLE001 - include fallback diagnostics.
                last_error = fallback_exc
                log(
                    f"{symbol}: EastMoney fallback attempt {attempt}/{attempts} failed: "
                    f"{fallback_exc}"
                )
            try:
                bars = fetch_symbol_from_sina(symbol, start, end)
                if not bars:
                    raise ValueError(f"{symbol} Sina fallback returned no bars")
                log(f"{symbol}: Sina fallback fetched {len(bars)} bars through {bars[-1].date}")
                return bars
            except Exception as sina_exc:  # noqa: BLE001 - include fallback diagnostics.
                last_error = sina_exc
                log(
                    f"{symbol}: Sina fallback attempt {attempt}/{attempts} failed: "
                    f"{sina_exc}"
                )
            try:
                bars = fetch_symbol_from_yahoo(symbol, start, end)
                if not bars:
                    raise ValueError(f"{symbol} Yahoo fallback returned no bars")
                log(f"{symbol}: Yahoo fallback fetched {len(bars)} bars through {bars[-1].date}")
                return bars
            except Exception as yahoo_exc:  # noqa: BLE001 - include fallback diagnostics.
                last_error = yahoo_exc
                log(
                    f"{symbol}: Yahoo fallback attempt {attempt}/{attempts} failed: "
                    f"{yahoo_exc}"
                )
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
        finally:
            time.sleep(max(0, args.symbol_sleep))

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
        "source": "multi-provider.etf.daily",
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
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"wrote {len(bars)} bars for {len(succeeded_symbols)}/{len(args.symbols)} "
        f"symbols through {latest_date} to {output}"
    )


if __name__ == "__main__":
    main()
