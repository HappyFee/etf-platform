import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "./App";
import { StrategyLab } from "./components/StrategyLab";
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
  });
});
