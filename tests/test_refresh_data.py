import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch-akshare-etf.py"
SPEC = importlib.util.spec_from_file_location("etf_refresh", SCRIPT)
refresh = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = refresh
SPEC.loader.exec_module(refresh)


def bar(symbol="510300", day="2026-10-27", price=100):
    return refresh.MarketBar(symbol, day, price, price, price, price, 100, 10_000)


def cached_payload(symbols=("510300",)):
    return {
        "source": "test", "generatedAt": "2026-10-13T20:00:00Z", "priceAdjustment": "qfq",
        "latestDate": "2026-10-13", "requestedSymbols": list(symbols),
        "profiles": [{"symbol": symbol, "name": symbol, "exchange": "SH", "category": "宽基",
                      "trackingIndex": "index-" + symbol, "expenseRatio": 0.005} for symbol in symbols],
        "bars": [refresh.asdict(bar(symbol, day)) for symbol in symbols for day in ["2026-10-12", "2026-10-13"]],
        "universeSnapshots": [{"date": "2026-10-13", "symbols": list(symbols)}],
    }


class RefreshSafeguards(unittest.TestCase):
    def setUp(self):
        self.quiet = patch.object(refresh, "log")
        self.quiet.start()
        self.addCleanup(self.quiet.stop)

    def test_discovery_failure_retries_then_keeps_cached_mother_pool(self):
        args = SimpleNamespace(symbols=["510300"], discover=True, retries=1, retry_sleep=0, discover_limit=60)
        with patch.object(refresh, "discover_etfs", side_effect=RuntimeError("502")) as discover:
            symbols, discovered, mode = refresh.resolve_mother_pool(args, cached_payload())
        self.assertEqual(discover.call_count, 2)
        self.assertEqual(symbols, ["510300"])
        self.assertEqual(discovered, [])
        self.assertEqual(mode, "cached")

    def test_discovery_failure_without_cache_fails_explicitly(self):
        args = SimpleNamespace(symbols=[], discover=True, retries=0, retry_sleep=0, discover_limit=60)
        with patch.object(refresh, "discover_etfs", side_effect=RuntimeError("502")):
            with self.assertRaisesRegex(RuntimeError, "no valid cached mother pool"):
                refresh.resolve_mother_pool(args, {})

    def test_stale_primary_response_tries_the_next_provider(self):
        used = {}
        with patch.object(refresh, "fetch_symbol", return_value=[bar(day="2026-10-13")]), \
                patch.object(refresh, "fetch_symbol_from_eastmoney", return_value=[bar()]) as fallback:
            bars = refresh.fetch_symbol_with_retry("510300", "20261012", "20261027", "qfq", 0, 0, providers_used=used)
        self.assertEqual(bars[-1].date, "2026-10-27")
        self.assertEqual(used["510300"], "eastmoney")
        fallback.assert_called_once()

    def test_incomplete_full_history_tries_a_different_provider(self):
        with patch.object(refresh, "fetch_symbol", return_value=[bar()]), \
                patch.object(refresh, "fetch_symbol_from_eastmoney", return_value=[bar(day="2026-10-12"), bar()]):
            bars = refresh.fetch_symbol_with_retry("510300", "20261012", "20261027", "qfq", 0, 0,
                                                   minimum_start="2026-10-12")
        self.assertEqual(bars[0].date, "2026-10-12")

    def test_bad_prices_and_empty_or_stale_data_are_not_successes(self):
        for values in [[], [bar(day="2026-10-13")], [bar(price=0)], [bar(price=float("nan"))]]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                refresh.validate_fetched_bars(values, "510300", "20261012", "20261027")

    def test_sina_unadjusted_data_cannot_silently_replace_adjusted_prices(self):
        with self.assertRaisesRegex(ValueError, "raw prices"):
            refresh.fetch_symbol_from_sina("510300", "20261012", "20261027", "qfq")

    def test_yahoo_forward_adjustment_preserves_raw_turnover(self):
        result = {"timestamp": [1793059200, 1793145600], "indicators": {
            "quote": [{"open": [100, 100], "high": [100, 100], "low": [100, 100],
                       "close": [100, 100], "volume": [100, 100]}],
            "adjclose": [{"adjclose": [90, 100]}],
        }}
        bars = refresh.parse_yahoo_chart("510300", result, "qfq")
        self.assertEqual([item.close for item in bars], [90, 100])
        self.assertEqual([item.amount for item in bars], [10_000, 10_000])
        result["indicators"].pop("adjclose")
        with self.assertRaisesRegex(ValueError, "adjusted closes"):
            refresh.parse_yahoo_chart("510300", result, "qfq")

    def test_atomic_write_failure_does_not_damage_the_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "bars.json"
            output.write_text('{"original":true}', encoding="utf-8")
            with self.assertRaises(ValueError):
                refresh.atomic_write_json(output, {"invalid": float("nan")})
            self.assertEqual(output.read_text(encoding="utf-8"), '{"original":true}')
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def run_main(self, output, report, symbols):
        argv = [str(SCRIPT), "--symbols", *symbols, "--start", "20261012", "--end", "20261027",
                "--symbol-sleep", "0", "--metadata-sleep", "0", "--output", str(output), "--report", str(report)]
        with patch.object(sys, "argv", argv), patch.object(refresh, "expected_session_date", return_value="2026-10-27"), \
                patch.object(refresh, "next_session_date", return_value="2026-10-28"):
            refresh.main()

    def test_stale_refresh_fails_and_preserves_old_data_and_reports_error(self):
        with tempfile.TemporaryDirectory() as directory:
            output, report = Path(directory) / "bars.json", Path(directory) / "report.json"
            original = json.dumps(cached_payload())
            output.write_text(original, encoding="utf-8")
            with patch.object(refresh, "fetch_symbol_with_retry", return_value=[bar(day="2026-10-13")]):
                with self.assertRaises(SystemExit):
                    self.run_main(output, report, ["510300"])
            self.assertEqual(output.read_text(encoding="utf-8"), original)
            status = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(status["status"], "failure")
            self.assertEqual(status["freshRatio"], 0)
            self.assertEqual(status["expectedLatestDate"], "2026-10-27")

    def test_one_current_symbol_cannot_hide_a_stale_majority(self):
        symbols = ["510300", "510500"]
        with tempfile.TemporaryDirectory() as directory:
            output, report = Path(directory) / "bars.json", Path(directory) / "report.json"
            original = json.dumps(cached_payload(symbols))
            output.write_text(original, encoding="utf-8")
            def provider(symbol, *args, **kwargs):
                return [bar(symbol, "2026-10-12"), bar(symbol, "2026-10-27" if symbol == "510300" else "2026-10-13")]
            with patch.object(refresh, "fetch_symbol_with_retry", side_effect=provider):
                with self.assertRaises(SystemExit):
                    self.run_main(output, report, symbols)
            self.assertEqual(output.read_text(encoding="utf-8"), original)
            self.assertEqual(json.loads(report.read_text(encoding="utf-8"))["freshRatio"], 0.5)

    def test_fresh_data_is_published_without_erasing_history_or_backdating_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            output, report = Path(directory) / "bars.json", Path(directory) / "report.json"
            output.write_text(json.dumps(cached_payload()), encoding="utf-8")
            with patch.object(refresh, "fetch_symbol_with_retry", return_value=[bar(day="2026-10-12"), bar()]):
                self.run_main(output, report, ["510300"])
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["latestDate"], "2026-10-27")
            self.assertEqual(payload["succeededSymbols"], ["510300"])
            self.assertEqual(payload["universeSnapshots"], cached_payload()["universeSnapshots"])
            self.assertEqual(json.loads(report.read_text(encoding="utf-8"))["status"], "success")

    def test_partial_success_preserves_failed_history_without_counting_it_as_fresh(self):
        symbols = ["510300", "510500", "512100", "512880", "511880"]
        with tempfile.TemporaryDirectory() as directory:
            output, report = Path(directory) / "bars.json", Path(directory) / "report.json"
            previous = cached_payload(symbols)
            output.write_text(json.dumps(previous), encoding="utf-8")

            def provider(symbol, *args, **kwargs):
                if symbol == "511880":
                    raise ValueError("provider unavailable")
                return [bar(symbol, "2026-10-12"), bar(symbol)]

            with patch.object(refresh, "fetch_symbol_with_retry", side_effect=provider):
                self.run_main(output, report, symbols)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["freshRatio"], 0.8)
            self.assertEqual(payload["succeededSymbols"], symbols[:-1])
            self.assertIn("511880", payload["failedSymbols"])
            self.assertEqual([item for item in payload["bars"] if item["symbol"] == "511880"],
                             [item for item in previous["bars"] if item["symbol"] == "511880"])


@unittest.skipUnless(importlib.util.find_spec("exchange_calendars"), "trading calendar dependency is not installed")
class TradingCalendarTests(unittest.TestCase):
    def test_next_refresh_session_skips_the_national_holiday(self):
        self.assertEqual(refresh.next_session_date("2026-09-30"), "2026-10-08")

    def test_weekends_holidays_and_china_midnight(self):
        for now, expected in [
            (datetime(2026, 10, 27, 19, tzinfo=refresh.CHINA_TIMEZONE), "2026-10-27"),
            (datetime(2026, 10, 27, 10, tzinfo=refresh.CHINA_TIMEZONE), "2026-10-26"),
            (datetime(2026, 10, 25, 19, tzinfo=refresh.CHINA_TIMEZONE), "2026-10-23"),
            (datetime(2026, 10, 5, 19, tzinfo=refresh.CHINA_TIMEZONE), "2026-09-30"),
            (datetime(2026, 10, 27, 1, tzinfo=refresh.CHINA_TIMEZONE), "2026-10-26"),
        ]:
            with self.subTest(now=now):
                self.assertEqual(refresh.expected_session_date(now=now), expected)


if __name__ == "__main__":
    unittest.main()
