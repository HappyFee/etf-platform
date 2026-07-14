import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AccountPanel, App, DataSourceNotice } from "./App";
import { StrategyLab } from "./components/StrategyLab";
import { SignalPanel } from "./components/SignalPanel";
import { runBacktest } from "./core/backtest";
import { defaultStrategies, defaultStrategy } from "./core/defaultStrategy";
import { etfProfiles, marketBars } from "./core/sampleData";

describe("App", () => {
  test("renders the ETF strategy platform workspace", () => {
    const html = renderToString(<App />);

    expect(html).toContain("策略总览");
    expect(html).toContain("策略实验室");
    expect(html).toContain("因子库");
    expect(html).toContain("信号跟踪");
    expect(html).toContain("样本外验证");
    expect(html).toContain("回测档案");
    expect(html).toContain("aria-current=\"page\"");
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
        activeStrategyId={config.id}
        config={config}
        onChange={() => undefined}
        onCreateBase={() => undefined}
        onCreateComposite={() => undefined}
        onDelete={() => undefined}
        onDuplicate={() => undefined}
        onSelect={() => undefined}
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
        activeStrategyId={defaultStrategy.id}
        config={defaultStrategy}
        onChange={() => undefined}
        onCreateBase={() => undefined}
        onCreateComposite={() => undefined}
        onDelete={() => undefined}
        onDuplicate={() => undefined}
        onSelect={() => undefined}
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
