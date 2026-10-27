import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AccountPanel, App, DataSourceNotice } from "./App";
import { StrategyLab } from "./components/StrategyLab";
import { SignalPanel } from "./components/SignalPanel";
import { runBacktest } from "./core/backtest";
import { defaultStrategies, defaultStrategy } from "./core/defaultStrategy";
import { etfProfiles, marketBars } from "./core/sampleData";

describe("App", () => {
  test("warns when some symbols failed even though the overall date is current", () => {
    const html = renderToString(<DataSourceNotice generatedUrl="/data/bars.json" loadStatus="loaded"
      latestDate="2099-10-27" nextTradingDate="2099-10-28" failedSymbolCount={2} />);
    expect(html).toContain("2 只 ETF 未更新");
    expect(html).toContain("仍保留旧历史");
  });
  test("uses the next trading session deadline to warn early without holiday false alarms", () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(Date.parse("2026-10-05T22:00:00+08:00"));
      expect(renderToString(<DataSourceNotice generatedUrl="/data/bars.json" loadStatus="loaded"
        latestDate="2026-09-30" nextTradingDate="2026-10-08" />)).toBe("");
      now.mockReturnValue(Date.parse("2026-10-27T22:00:00+08:00"));
      const html = renderToString(<DataSourceNotice generatedUrl="/data/bars.json" loadStatus="loaded"
        latestDate="2026-10-26" nextTradingDate="2026-10-27" />);
      expect(html).toContain("行情尚未更新");
      expect(html).toContain("2026-10-27");
    } finally {
      now.mockRestore();
    }
  });
  test("renders the ETF strategy platform workspace", () => {
    const html = renderToString(<App />);

    expect(html).toContain("策略总览");
    expect(html).toContain("策略实验室");
    expect(html).toContain("因子库");
    expect(html).toContain("信号跟踪");
    expect(html).toContain("样本外验证");
    expect(html).toContain("回测档案");
    expect(html).toContain("aria-current=\"page\"");
    expect(html.match(/<select id="active-strategy"/g)).toHaveLength(1);
    expect(html.indexOf('id="active-strategy"')).toBeLessThan(html.indexOf('aria-label="平台导航"'));
  });

  test("renders configurable rebalance day, ETF search, and fixed rank weights", () => {
    const config = {
      ...defaultStrategy,
      portfolio: {
        topN: 3,
        weighting: "fixed" as const,
        fixedWeights: [0.5, 0.3, 0.2]
      }
    };
    const html = renderToString(
      <StrategyLab
        config={config}
        onChange={() => undefined}
        profiles={etfProfiles}
        result={runBacktest({ bars: marketBars, profiles: etfProfiles, config })}
        strategies={defaultStrategies}
      />
    );

    expect(html).toContain("调仓周几");
    expect(html).toContain("输入 ETF 名称、代码、分类或跟踪指数");
    expect(html).toContain("第1名比例");
  });

  test("renders platform controls for factor instances, filters, and risk constraints", () => {
    const html = renderToString(
      <StrategyLab
        config={defaultStrategy}
        onChange={() => undefined}
        profiles={etfProfiles}
        result={runBacktest({ bars: marketBars, profiles: etfProfiles, config: defaultStrategy })}
        strategies={defaultStrategies}
      />
    );

    expect(html).toContain("data-testid=\"add-factor-button\"");
    expect(html).toContain("data-testid=\"add-filter-button\"");
    expect(html).toContain("data-testid=\"max-position-input\"");
    expect(html).toContain("data-testid=\"min-cash-input\"");
    expect(html).toContain("data-testid=\"cash-replacement-select\"");
    expect(html).toContain("data-testid=\"benchmark-select\"");
    expect(html).toContain("data-testid=\"backtest-start-date\"");
    expect(html).toContain("data-testid=\"backtest-end-date\"");
    expect(html).toContain("data-testid=\"execution-price-select\"");
    expect(html).toContain("data-testid=\"minimum-commission-input\"");
    expect(html).toContain("data-testid=\"participation-rate-input\"");
    expect(html).toContain("data-testid=\"price-limit-input\"");
  });

  test("renders a visible notice when generated data fails to load", () => {
    const html = renderToString(
      <DataSourceNotice
        generatedUrl="/data/a-share-etf-bars.generated.json"
        loadStatus="failed"
      />
    );

    expect(html).toContain("data-testid=\"data-source-notice\"");
    expect(html).toContain("/data/a-share-etf-bars.generated.json");
  });

  test("labels stale market data explicitly instead of presenting old signals as current", () => {
    const html = renderToString(<DataSourceNotice generatedUrl="/data/bars.json"
      loadStatus="loaded" latestDate="2020-01-01" />);
    expect(html).toContain("超过 7 天未更新");
    expect(html).toContain("历史行情");
    expect(renderToString(<DataSourceNotice generatedUrl="/data/bars.json"
      loadStatus="loading" latestDate="2020-01-01" />)).toBe("");
  });

  test("renders account controls for the active account", () => {
    const html = renderToString(
      <AccountPanel
        account={{
          id: "wechat-local-demo",
          provider: "wechat",
          displayName: "微信用户 demo"
        }}
        isOAuthConfigured={false}
        onLocalLogin={() => undefined}
        onLogout={() => undefined}
        onWeChatLogin={() => undefined}
      />
    );

    expect(html).toContain("data-testid=\"account-panel\"");
    expect(html).toContain("微信用户 demo");
    expect(html).toContain("微信登录");
    expect(html).toContain("已保存到本机");
  });
  test("renders Supabase email login controls when configured", () => {
    const html = renderToString(
      <AccountPanel
        account={{
          id: "local-default",
          provider: "local",
          displayName: "本地账号"
        }}
        isOAuthConfigured={false}
        isSupabaseConfigured={true}
        onLocalLogin={() => undefined}
        onLogout={() => undefined}
        onSupabaseEmailChange={() => undefined}
        onSupabaseLogin={() => undefined}
        onWeChatLogin={() => undefined}
        supabaseEmail="owner@example.com"
        supabaseStatus="idle"
      />
    );

    expect(html).toContain("data-testid=\"supabase-email-input\"");
    expect(html).toContain("data-testid=\"supabase-login-button\"");
    expect(html).toContain("owner@example.com");
  });

  test("shows uninvested weight as cash in the signal view", () => {
    const result = runBacktest({
      bars: marketBars,
      profiles: etfProfiles,
      config: {
        ...defaultStrategy,
        risk: {
          ...defaultStrategy.risk,
          minCashWeight: 0.25,
          cashReplacementSymbol: undefined
        }
      }
    });
    const html = renderToString(<SignalPanel result={result} />);

    expect(html).toContain("现金");
    expect(html).toContain("25%");
  });
});
