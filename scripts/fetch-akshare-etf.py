#!/usr/bin/env python3
"""Fetch A-share ETF daily bars with akshare and write normalized JSON.

The web app works without this file because it ships deterministic demo data.
Run this script in GitHub Actions or locally when you want real ETF bars:

    python scripts/fetch-akshare-etf.py --output public/data/a-share-etf-bars.generated.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

CHINA_TIMEZONE = timezone(timedelta(hours=8))


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
    "511880",
    "159928",
    "159981",
]


PROFILE_NAMES = {
    "511880": ("银华日利ETF", "SH", "货币", "货币市场"),
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


ETF_CODE_PATTERN = re.compile(r"^(?:15|51|52|56|58)\d{4}$")
UNSUPPORTED_PRODUCT_PATTERN = re.compile(
    r"(?:LOF|REIT|分级|杠杆|反向|两倍|2倍|三倍|3倍|联接)", re.IGNORECASE
)


@dataclass
class EtfProfile:
    symbol: str
    name: str
    exchange: str
    category: str
    trackingIndex: str
    expenseRatio: float = 0.005
    listedDate: str | None = None
    assetSize: float | None = None
    discoveredAt: str | None = None


@dataclass
class DiscoveredEtf:
    symbol: str
    name: str
    amount: float


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
    parser.add_argument("--symbols", nargs="*", default=None)
    parser.add_argument(
        "--discover",
        action="store_true",
        help="Discover a broad liquid ETF mother pool from the current market snapshot.",
    )
    parser.add_argument("--discover-limit", type=int, default=60)
    parser.add_argument("--start", default="20210101")
    parser.add_argument("--end", help="Last requested date, YYYYMMDD; defaults to the latest completed session.")
    parser.add_argument("--adjust", default="qfq", choices=["", "qfq", "hfq"])
    parser.add_argument(
        "--full-refresh",
        action="store_true",
        help="Refetch the complete requested range instead of the recent overlap.",
    )
    parser.add_argument("--overlap-days", type=int, default=14)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--retry-sleep", type=float, default=2)
    parser.add_argument("--symbol-sleep", type=float, default=1.5)
    parser.add_argument("--metadata-sleep", type=float, default=0.2)
    parser.add_argument("--min-success-ratio", type=float, default=0.8)
    parser.add_argument("--report", help="Write refresh diagnostics to this JSON path, including on failure.")
    parser.add_argument(
        "--output",
        default="public/data/a-share-etf-bars.generated.json",
        help="Path to normalized output JSON.",
    )
    return parser.parse_args()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def expected_session_date(end: str | None = None, now: datetime | None = None) -> str:
    import exchange_calendars as calendars

    current = (now or datetime.now(CHINA_TIMEZONE)).astimezone(CHINA_TIMEZONE)
    completed = current.date()
    if current.time() < day_time(18):
        completed -= timedelta(days=1)
    requested = min(date.fromisoformat(f"{end[:4]}-{end[4:6]}-{end[6:8]}"), completed) if end else completed
    calendar = calendars.get_calendar("XSHG")
    return calendar.date_to_session(requested.isoformat(), direction="previous").strftime("%Y-%m-%d")


def next_session_date(session: str) -> str:
    import exchange_calendars as calendars

    return calendars.get_calendar("XSHG").next_session(session).strftime("%Y-%m-%d")


def atomic_write_json(output: Path, payload: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent,
                                         prefix=f".{output.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        temporary.replace(output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def resolve_mother_pool(args: argparse.Namespace, existing: dict[str, Any]) -> tuple[list[str], list[DiscoveredEtf], str]:
    pinned = args.symbols if args.symbols is not None else DEFAULT_SYMBOLS
    if not args.discover:
        return unique_symbols(pinned), [], "fixed"
    last_error: Exception | None = None
    for attempt in range(max(1, args.retries + 1)):
        try:
            discovered = discover_etfs()
            symbols = select_discovered_symbols(discovered, args.discover_limit, pinned,
                                                 existing.get("requestedSymbols", []) or [])
            return symbols, discovered, "live"
        except Exception as exc:
            last_error = exc
            log(f"ETF discovery attempt {attempt + 1} failed: {exc}")
            if attempt < args.retries:
                time.sleep(max(0, args.retry_sleep) * (attempt + 1))
    cached = unique_symbols(existing.get("requestedSymbols", []) or [])
    available = {item.get("symbol") for item in existing.get("profiles", []) if isinstance(item, dict)}
    cached = [symbol for symbol in cached if ETF_CODE_PATTERN.fullmatch(symbol) and symbol in available]
    if not cached:
        raise RuntimeError(f"ETF discovery failed and no valid cached mother pool exists: {last_error}")
    log(f"::warning::ETF discovery unavailable; refreshing the last valid mother pool ({len(cached)} symbols): {last_error}")
    return unique_symbols([*cached, *pinned]), [], "cached"


def validate_fetched_bars(bars: list[MarketBar], symbol: str, start: str, end: str) -> list[MarketBar]:
    start_iso = date.fromisoformat(f"{start[:4]}-{start[4:6]}-{start[6:8]}").isoformat()
    end_iso = date.fromisoformat(f"{end[:4]}-{end[4:6]}-{end[6:8]}").isoformat()
    selected: dict[str, MarketBar] = {}
    for bar in bars:
        if bar.symbol != symbol or not start_iso <= bar.date <= end_iso:
            continue
        date.fromisoformat(bar.date)
        if not all(math.isfinite(value) and value > 0 for value in [bar.open, bar.high, bar.low, bar.close]):
            raise ValueError(f"{symbol} invalid prices on {bar.date}")
        if not all(math.isfinite(value) and value >= 0 for value in [bar.volume, bar.amount]) or bar.high < bar.low:
            raise ValueError(f"{symbol} invalid liquidity or price range on {bar.date}")
        selected[bar.date] = bar
    result = sorted(selected.values(), key=lambda bar: bar.date)
    if not result or result[-1].date < end_iso:
        raise ValueError(f"{symbol} stale or empty response: latest={result[-1].date if result else None}, expected={end_iso}")
    return result


def unique_symbols(symbols: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(str(symbol).strip() for symbol in symbols if str(symbol).strip()))


def normalize_symbol(value: object) -> str:
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text.zfill(6)


def finite_number(value: object, default: float = 0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def clean_text(value: object, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, float) and math.isnan(value):
        return default
    text = str(value).strip()
    return text if text and text.lower() != "nan" else default


def discover_etfs() -> list[DiscoveredEtf]:
    try:
        import akshare as ak  # type: ignore
    except ImportError as exc:
        raise RuntimeError("akshare is required: pip install akshare pandas") from exc

    frame = ak.fund_etf_spot_em()
    required_columns = ["代码", "名称", "成交额"]
    missing = [column for column in required_columns if column not in frame.columns]
    if missing:
        raise ValueError(f"ETF discovery missing expected columns: {missing}")

    discovered: dict[str, DiscoveredEtf] = {}
    for record in frame.to_dict("records"):
        symbol = normalize_symbol(record["代码"])
        name = clean_text(record["名称"], symbol)
        if not ETF_CODE_PATTERN.fullmatch(symbol) or UNSUPPORTED_PRODUCT_PATTERN.search(name):
            continue
        candidate = DiscoveredEtf(
            symbol=symbol,
            name=name,
            amount=max(0, finite_number(record["成交额"])),
        )
        previous = discovered.get(symbol)
        if previous is None or candidate.amount > previous.amount:
            discovered[symbol] = candidate

    if not discovered:
        raise ValueError("ETF discovery returned no supported exchange-traded funds")
    return sorted(discovered.values(), key=lambda item: (-item.amount, item.symbol))


def select_discovered_symbols(
    discovered: list[DiscoveredEtf],
    limit: int,
    pinned_symbols: Iterable[str],
    previous_symbols: Iterable[str],
) -> list[str]:
    limit = max(1, limit)
    ranking = [item.symbol for item in discovered]
    ranking_set = set(ranking)
    pinned = unique_symbols(pinned_symbols)
    previous = set(previous_symbols)
    selected: list[str] = []

    for symbol in pinned:
        if symbol in ranking_set or symbol in PROFILE_NAMES:
            selected.append(symbol)

    retention_limit = min(len(ranking), math.ceil(limit * 1.3))
    for symbol in ranking[:retention_limit]:
        if symbol in previous and symbol not in selected and len(selected) < limit:
            selected.append(symbol)

    for symbol in ranking:
        if symbol not in selected and len(selected) < limit:
            selected.append(symbol)

    return selected


def infer_category(name: str, tracking_index: str, fund_type: str = "") -> str:
    text = f"{name} {tracking_index} {fund_type}"
    category_keywords = [
        ("货币", ("货币", "日利", "添益", "保证金")),
        ("债券", ("债", "政金", "国开", "信用")),
        ("商品", ("黄金", "白银", "豆粕", "商品", "能源化工")),
        ("海外", ("QDII", "纳指", "标普", "恒生", "港股", "日经", "德国", "法国")),
        ("消费", ("消费", "食品", "酒", "家电", "旅游")),
        ("医药", ("医药", "医疗", "创新药", "生物")),
        ("新能源", ("新能源", "光伏", "电池", "储能", "碳中和")),
        ("科技", ("科技", "芯片", "半导体", "人工智能", "软件", "通信", "机器人")),
        ("金融", ("证券", "银行", "保险", "金融")),
        ("周期", ("有色", "煤炭", "钢铁", "化工", "资源")),
    ]
    for category, keywords in category_keywords:
        if any(keyword.lower() in text.lower() for keyword in keywords):
            return category

    broad_keywords = (
        "沪深300",
        "中证500",
        "中证1000",
        "中证2000",
        "上证50",
        "A500",
        "创业板",
        "科创50",
        "红利",
    )
    return "宽基" if any(keyword.lower() in text.lower() for keyword in broad_keywords) else "主题"


def parse_percentage(value: object, default: float = 0.005) -> float:
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", clean_text(value))
    return float(match.group(1)) / 100 if match else default


def parse_listed_date(value: object) -> str | None:
    match = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", clean_text(value))
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    return date(year, month, day).isoformat()


def parse_asset_size(value: object) -> float | None:
    text = clean_text(value)
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
    if not match:
        return None
    amount = float(match.group(1))
    if "亿" in text:
        amount *= 100_000_000
    elif "万" in text:
        amount *= 10_000
    return amount


def fetch_profile_metadata(symbol: str, fallback_name: str, discovered_at: str) -> EtfProfile:
    try:
        import akshare as ak  # type: ignore
    except ImportError as exc:
        raise RuntimeError("akshare is required: pip install akshare pandas") from exc

    frame = ak.fund_overview_em(symbol=symbol)
    if frame.empty:
        raise ValueError(f"{symbol} overview returned no metadata")
    record: dict[str, Any] = frame.to_dict("records")[0]
    name = clean_text(record.get("基金简称"), fallback_name)
    tracking_index = clean_text(record.get("跟踪标的"), name)
    if "无跟踪标的" in tracking_index:
        tracking_index = name
    fund_type = clean_text(record.get("基金类型"))
    return EtfProfile(
        symbol=symbol,
        name=name,
        exchange="SH" if symbol.startswith("5") else "SZ",
        category=infer_category(name, tracking_index, fund_type),
        trackingIndex=tracking_index,
        expenseRatio=parse_percentage(record.get("管理费率")),
        listedDate=parse_listed_date(record.get("成立日期/规模")),
        assetSize=parse_asset_size(record.get("资产规模")),
        discoveredAt=discovered_at,
    )


def profile_from_payload(value: object) -> EtfProfile | None:
    if not isinstance(value, dict):
        return None
    symbol = clean_text(value.get("symbol"))
    exchange = clean_text(value.get("exchange"))
    if not symbol or exchange not in {"SH", "SZ"}:
        return None
    return EtfProfile(
        symbol=symbol,
        name=clean_text(value.get("name"), symbol),
        exchange=exchange,
        category=clean_text(value.get("category"), "主题"),
        trackingIndex=clean_text(value.get("trackingIndex"), symbol),
        expenseRatio=finite_number(value.get("expenseRatio"), 0.005),
        listedDate=clean_text(value.get("listedDate")) or None,
        assetSize=finite_number(value.get("assetSize")) or None,
        discoveredAt=clean_text(value.get("discoveredAt")) or None,
    )


def build_profiles(
    symbols: Iterable[str],
    discovered_by_symbol: dict[str, DiscoveredEtf],
    existing_by_symbol: dict[str, EtfProfile],
    discovered_at: str,
    metadata_sleep: float,
) -> list[EtfProfile]:
    profiles: list[EtfProfile] = []
    for symbol in symbols:
        existing = existing_by_symbol.get(symbol)
        if existing and existing.category != "ETF" and existing.trackingIndex != symbol:
            profiles.append(existing)
            continue

        known = PROFILE_NAMES.get(symbol)
        fallback_name = discovered_by_symbol.get(symbol, DiscoveredEtf(symbol, symbol, 0)).name
        if known:
            name, exchange, category, tracking_index = known
            profiles.append(
                EtfProfile(
                    symbol=symbol,
                    name=name,
                    exchange=exchange,
                    category=category,
                    trackingIndex=tracking_index,
                    discoveredAt=existing.discoveredAt if existing else discovered_at,
                )
            )
            continue

        try:
            profiles.append(fetch_profile_metadata(symbol, fallback_name, discovered_at))
        except Exception as exc:  # noqa: BLE001 - metadata should not block market data refresh.
            log(f"{symbol}: metadata lookup failed, using inferred profile: {exc}")
            tracking_index = fallback_name.replace("ETF", "").strip() or symbol
            profiles.append(
                EtfProfile(
                    symbol=symbol,
                    name=fallback_name,
                    exchange="SH" if symbol.startswith("5") else "SZ",
                    category=infer_category(fallback_name, tracking_index),
                    trackingIndex=tracking_index,
                    discoveredAt=existing.discoveredAt if existing else discovered_at,
                )
            )
        finally:
            time.sleep(max(0, metadata_sleep))
    return profiles


def fetch_symbol(symbol: str, start: str, end: str, adjust: str) -> list[MarketBar]:
    try:
        import akshare as ak  # type: ignore
    except ImportError as exc:
        raise RuntimeError("akshare is required: pip install akshare pandas") from exc

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


def fetch_symbol_from_sina(symbol: str, start: str, end: str, adjust: str = "") -> list[MarketBar]:
    if adjust:
        raise ValueError("Sina raw prices cannot replace adjusted history")
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


def fetch_symbol_from_yahoo(symbol: str, start: str, end: str, adjust: str = "") -> list[MarketBar]:
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

    return parse_yahoo_chart(symbol, result, adjust)


def parse_yahoo_chart(symbol: str, result: dict[str, Any], adjust: str) -> list[MarketBar]:
    if adjust == "hfq":
        raise ValueError("Yahoo cannot provide a consistent inception-based backward adjustment")

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [None])[0]
    if not timestamps or not quote:
        raise ValueError(f"{symbol} Yahoo returned no daily quote")
    adjusted = (((result.get("indicators") or {}).get("adjclose") or [{}])[0]).get("adjclose") or []
    adjustment_anchor = 1.0
    if adjust == "qfq":
        anchors = [float(adjusted[index]) / float(close) for index, close in enumerate(quote.get("close") or [])
                   if close and index < len(adjusted) and adjusted[index] and
                   math.isfinite(float(close)) and math.isfinite(float(adjusted[index])) and
                   float(close) > 0 and float(adjusted[index]) > 0]
        if not anchors:
            raise ValueError(f"{symbol} Yahoo response has no adjusted closes")
        adjustment_anchor = anchors[-1]

    bars: list[MarketBar] = []
    for index, timestamp in enumerate(timestamps):
        open_price = value_at(quote.get("open") or [], index)
        high = value_at(quote.get("high") or [], index)
        low = value_at(quote.get("low") or [], index)
        close = value_at(quote.get("close") or [], index)
        volume = value_at(quote.get("volume") or [], index, 0) or 0
        if open_price is None or high is None or low is None or close is None:
            continue
        factor = 1.0
        if adjust == "qfq":
            adjusted_close = value_at(adjusted, index)
            if adjusted_close is None or float(close) <= 0 or finite_number(adjusted_close) <= 0:
                raise ValueError(f"{symbol} Yahoo response has incomplete adjustment data")
            factor = float(adjusted_close) / float(close) / adjustment_anchor
        bars.append(
            MarketBar(
                symbol=symbol,
                date=datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat(),
                open=float(open_price) * factor,
                high=float(high) * factor,
                low=float(low) * factor,
                close=float(close) * factor,
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
    minimum_start: str | None = None,
    providers_used: dict[str, str] | None = None,
) -> list[MarketBar]:
    attempts = max(1, retries + 1)
    last_error: Exception | None = None

    providers = [
        ("akshare-eastmoney", lambda: fetch_symbol(symbol, start, end, adjust)),
        ("eastmoney", lambda: fetch_symbol_from_eastmoney(symbol, start, end, adjust)),
        ("sina", lambda: fetch_symbol_from_sina(symbol, start, end, adjust)),
        ("yahoo", lambda: fetch_symbol_from_yahoo(symbol, start, end, adjust)),
    ]
    for attempt in range(1, attempts + 1):
        for provider, fetcher in providers:
            try:
                bars = validate_fetched_bars(fetcher(), symbol, start, end)
                if minimum_start and bars[0].date > minimum_start:
                    raise ValueError(f"incomplete history: starts {bars[0].date}, need {minimum_start}")
                if providers_used is not None:
                    providers_used[symbol] = provider
                log(f"{symbol}: {provider} fetched {len(bars)} bars through {bars[-1].date}")
                return bars
            except Exception as exc:
                last_error = exc
                log(f"{symbol}: {provider} attempt {attempt}/{attempts} failed: {exc}")
        if attempt < attempts:
            time.sleep(max(0, retry_sleep) * attempt)

    raise ValueError(f"{symbol} failed after {attempts} attempts: {last_error}")


def load_existing_payload(output: Path) -> dict[str, Any]:
    if not output.exists():
        return {}
    try:
        payload = json.loads(output.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        log(f"existing output ignored because it could not be read: {exc}")
        return {}


def market_bar_from_payload(value: object) -> MarketBar | None:
    if not isinstance(value, dict):
        return None
    try:
        return MarketBar(
            symbol=clean_text(value.get("symbol")),
            date=clean_text(value.get("date")),
            open=float(value["open"]),
            high=float(value["high"]),
            low=float(value["low"]),
            close=float(value["close"]),
            volume=int(float(value["volume"])),
            amount=int(float(value["amount"])),
        )
    except (KeyError, TypeError, ValueError):
        return None


def incremental_start(
    symbol: str,
    existing_by_symbol: dict[str, list[MarketBar]],
    configured_start: str,
    overlap_days: int,
) -> str:
    history = existing_by_symbol.get(symbol) or []
    if not history:
        return configured_start
    latest = date.fromisoformat(max(bar.date for bar in history))
    overlap_start = (latest - timedelta(days=max(0, overlap_days))).strftime("%Y%m%d")
    return max(configured_start, overlap_start)


def membership_snapshots_from_payload(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    snapshots: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        snapshot_date = clean_text(item.get("date"))
        symbols = item.get("symbols")
        if snapshot_date and isinstance(symbols, list):
            snapshots.append(
                {
                    "date": snapshot_date,
                    "symbols": sorted(unique_symbols(symbols)),
                }
            )
    return sorted(snapshots, key=lambda item: item["date"])


def update_membership_snapshots(
    existing: list[dict[str, Any]], snapshot_date: str, symbols: Iterable[str]
) -> list[dict[str, Any]]:
    current_symbols = sorted(unique_symbols(symbols))
    snapshots = [item for item in existing if item["date"] != snapshot_date]
    latest = snapshots[-1] if snapshots else None
    if latest and latest["date"] > snapshot_date:
        return snapshots
    if latest and latest["symbols"] == current_symbols:
        return snapshots
    snapshots.append({"date": snapshot_date, "symbols": current_symbols})
    return sorted(snapshots, key=lambda item: item["date"])


def profile_payload(profile: EtfProfile) -> dict[str, Any]:
    return {key: value for key, value in asdict(profile).items() if value is not None}


def run_refresh(args: argparse.Namespace, report: dict[str, Any]) -> None:
    if not 0 < args.min_success_ratio <= 1:
        raise ValueError("min-success-ratio must be between 0 (exclusive) and 1")
    expected_date = expected_session_date(args.end)
    next_trading_date = next_session_date(expected_date)
    fetch_end = expected_date.replace("-", "")
    full_refresh = args.full_refresh or bool(args.adjust)
    report["expectedLatestDate"] = expected_date
    report["nextTradingDate"] = next_trading_date
    output = Path(args.output)
    existing_payload = load_existing_payload(output)
    if existing_payload.get("priceAdjustment") != args.adjust:
        full_refresh = True
    existing_bars = [
        bar
        for item in existing_payload.get("bars", []) or []
        if (bar := market_bar_from_payload(item)) is not None and bar.symbol and bar.date
    ]
    existing_bars_by_symbol: dict[str, list[MarketBar]] = {}
    for bar in existing_bars:
        existing_bars_by_symbol.setdefault(bar.symbol, []).append(bar)

    existing_profiles = [
        profile
        for item in existing_payload.get("profiles", []) or []
        if (profile := profile_from_payload(item)) is not None
    ]
    existing_profile_by_symbol = {profile.symbol: profile for profile in existing_profiles}

    requested_symbols, discovered, discovery_mode = resolve_mother_pool(args, existing_payload)
    report["discoveryMode"] = discovery_mode
    report["requestedSymbols"] = requested_symbols
    discovered_by_symbol = {item.symbol: item for item in discovered}

    if not requested_symbols:
        raise RuntimeError("ETF data refresh failed: no symbols requested")

    discovered_at = datetime.now(CHINA_TIMEZONE).date().isoformat()
    current_profiles = build_profiles(
        requested_symbols,
        discovered_by_symbol,
        existing_profile_by_symbol,
        discovered_at,
        args.metadata_sleep,
    )
    profile_by_symbol = dict(existing_profile_by_symbol)
    profile_by_symbol.update({profile.symbol: profile for profile in current_profiles})

    merged_bars = {(bar.symbol, bar.date): bar for bar in existing_bars}

    refreshed_symbols: list[str] = []
    failed_symbols: dict[str, str] = {}
    providers_used: dict[str, str] = {}

    for symbol in requested_symbols:
        fetch_start = (
            args.start
            if full_refresh
            else incremental_start(
                symbol,
                existing_bars_by_symbol,
                args.start,
                args.overlap_days,
            )
        )
        try:
            previous_history = existing_bars_by_symbol.get(symbol) or []
            minimum_start = max(
                min(bar.date for bar in previous_history),
                f"{args.start[:4]}-{args.start[4:6]}-{args.start[6:8]}",
            ) if full_refresh and previous_history else None
            symbol_bars = fetch_symbol_with_retry(
                symbol,
                fetch_start,
                fetch_end,
                args.adjust,
                args.retries,
                args.retry_sleep,
                minimum_start=minimum_start,
                providers_used=providers_used,
            )
            symbol_bars = validate_fetched_bars(symbol_bars, symbol, fetch_start, fetch_end)
            if full_refresh:
                merged_bars = {
                    key: bar
                    for key, bar in merged_bars.items()
                    if key[0] != symbol
                }
            for bar in symbol_bars:
                merged_bars[(bar.symbol, bar.date)] = bar
            refreshed_symbols.append(symbol)
        except Exception as exc:  # noqa: BLE001 - keep one bad ETF from blocking all data.
            failed_symbols[symbol] = str(exc)
        finally:
            time.sleep(max(0, args.symbol_sleep))

    success_ratio = len(refreshed_symbols) / max(1, len(requested_symbols))
    report.update({
        "freshSymbols": refreshed_symbols,
        "failedSymbols": failed_symbols,
        "providers": providers_used,
        "freshRatio": success_ratio,
    })
    if not merged_bars or success_ratio < args.min_success_ratio:
        raise RuntimeError(
            "ETF data refresh failed: "
            f"only {len(refreshed_symbols)}/{len(requested_symbols)} symbols current through {expected_date}; "
            f"failed={failed_symbols}"
        )

    bars = sorted(merged_bars.values(), key=lambda item: (item.symbol, item.date))
    succeeded_symbols = refreshed_symbols
    latest_date = max(bar.date for bar in bars)
    earliest_date = min(bar.date for bar in bars)
    # A current observation must never be recorded as if it were known in the past.
    universe_snapshots = update_membership_snapshots(
        membership_snapshots_from_payload(existing_payload.get("universeSnapshots")),
        discovered_at,
        requested_symbols,
    )

    ordered_profile_symbols = unique_symbols(
        [*requested_symbols, *(bar.symbol for bar in bars), *profile_by_symbol]
    )
    profiles = [
        profile_by_symbol[symbol]
        for symbol in ordered_profile_symbols
        if symbol in profile_by_symbol
    ]

    payload = {
        "source": "multi-provider.etf.dynamic-daily" if args.discover else "multi-provider.etf.daily",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "startDate": earliest_date,
        "endDate": latest_date,
        "latestDate": latest_date,
        "requestedSymbols": requested_symbols,
        "succeededSymbols": succeeded_symbols,
        "failedSymbols": failed_symbols,
        "expectedLatestDate": expected_date,
        "nextTradingDate": next_trading_date,
        "discoveryMode": discovery_mode,
        "freshRatio": success_ratio,
        "providers": providers_used,
        "priceAdjustment": args.adjust,
        "estimatedAmountSymbols": [symbol for symbol, provider in providers_used.items() if provider == "yahoo"],
        "universeSnapshots": universe_snapshots,
        "profiles": [profile_payload(profile) for profile in profiles],
        "bars": [asdict(bar) for bar in bars],
    }

    atomic_write_json(output, payload)
    report.update({"status": "success", "latestDate": latest_date, "bars": len(bars)})
    print(
        f"wrote {len(bars)} bars for {len(succeeded_symbols)}/{len(requested_symbols)} "
        f"current symbols with {len(universe_snapshots)} membership snapshots "
        f"through {latest_date} to {output}"
    )


def main() -> None:
    args = parse_args()
    report: dict[str, Any] = {"status": "running", "startedAt": datetime.now(timezone.utc).isoformat()}
    try:
        run_refresh(args, report)
    except Exception as exc:
        report.update({"status": "failure", "error": str(exc)})
        log(f"::error::ETF data refresh failed; previous data preserved: {exc}")
        raise SystemExit(1) from exc
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        if args.report:
            atomic_write_json(Path(args.report), report)


if __name__ == "__main__":
    main()
