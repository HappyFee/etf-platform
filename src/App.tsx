import { Activity, BarChart3, BellRing, LibraryBig, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BacktestCharts } from "./components/BacktestCharts";
import { Dashboard } from "./components/Dashboard";
import { FactorLibrary } from "./components/FactorLibrary";
import { SignalPanel } from "./components/SignalPanel";
import { StrategyLab } from "./components/StrategyLab";
import { defaultStrategies, defaultStrategy, defaultCompositeStrategy } from "./core/defaultStrategy";
import { runBacktest } from "./core/backtest";
import { loadGeneratedDataset, sampleDataset } from "./core/dataSource";
import type { BaseStrategyConfig, CompositeStrategyConfig, StrategyConfig } from "./core/types";

type TabKey = "overview" | "lab" | "factors" | "signals";

const tabs: Array<{
  key: TabKey;
  label: string;
  icon: typeof BarChart3;
}> = [
  { key: "overview", label: "策略总览", icon: BarChart3 },
  { key: "lab", label: "策略实验室", icon: SlidersHorizontal },
  { key: "factors", label: "因子库", icon: LibraryBig },
  { key: "signals", label: "信号跟踪", icon: BellRing }
];

function cloneStrategy<T extends StrategyConfig>(strategy: T): T {
  return JSON.parse(JSON.stringify(strategy)) as T;
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [strategies, setStrategies] = useState<StrategyConfig[]>(
    defaultStrategies.map(cloneStrategy)
  );
  const [activeStrategyId, setActiveStrategyId] = useState(defaultStrategy.id);
  const [dataset, setDataset] = useState(sampleDataset);

  useEffect(() => {
    let cancelled = false;

    loadGeneratedDataset(fetch, `${import.meta.env.BASE_URL}data/a-share-etf-bars.generated.json`).then((generatedDataset) => {
      if (!cancelled && generatedDataset) {
        setDataset(generatedDataset);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const config = useMemo(
    () => strategies.find((strategy) => strategy.id === activeStrategyId) ?? strategies[0],
    [activeStrategyId, strategies]
  );

  const result = useMemo(
    () =>
      runBacktest({
        bars: dataset.bars,
        profiles: dataset.profiles,
        config,
        strategyBook: strategies
      }),
    [config, dataset, strategies]
  );
  const dataLatestDate = dataset.latestDate ?? result.latestSignal.date;
  const isDemoDataset = dataset.source.startsWith("demo");
  const symbolCoverage =
    dataset.requestedSymbols?.length && dataset.succeededSymbols?.length
      ? `${dataset.succeededSymbols.length}/${dataset.requestedSymbols.length}`
      : `${dataset.profiles.length}`;

  function updateActiveStrategy(next: StrategyConfig) {
    setStrategies((current) =>
      current.map((strategy) => (strategy.id === next.id ? next : strategy))
    );
  }

  function createBaseStrategy() {
    const next: BaseStrategyConfig = {
      ...cloneStrategy(defaultStrategy),
      id: uniqueId("base"),
      name: `新基础策略 ${strategies.length + 1}`,
      description: "自定义 ETF 池、因子参数和权重。"
    };
    setStrategies((current) => [...current, next]);
    setActiveStrategyId(next.id);
    setActiveTab("lab");
  }

  function createCompositeStrategy() {
    const next: CompositeStrategyConfig = {
      ...cloneStrategy(defaultCompositeStrategy),
      id: uniqueId("composite"),
      name: `新组合策略 ${strategies.length + 1}`,
      description: "按权重组合多个已有基础策略。",
      components: strategies
        .filter((strategy) => strategy.kind === "base")
        .slice(0, 2)
        .map((strategy, index) => ({
          strategyId: strategy.id,
          weight: index === 0 ? 0.6 : 0.4
        }))
    };
    setStrategies((current) => [...current, next]);
    setActiveStrategyId(next.id);
    setActiveTab("lab");
  }

  function duplicateActiveStrategy() {
    const next = cloneStrategy(config);
    next.id = uniqueId(config.kind === "composite" ? "composite" : "base");
    next.name = `${config.name} 副本`;
    setStrategies((current) => [...current, next]);
    setActiveStrategyId(next.id);
  }

  function deleteActiveStrategy() {
    if (strategies.length <= 1) {
      return;
    }
    const remaining = strategies.filter((strategy) => strategy.id !== config.id);
    setStrategies(remaining);
    setActiveStrategyId(remaining[0].id);
  }

  return (
    <main className="app-shell">
      <header className="top-band">
        <div className="top-band__content">
          <div>
            <p className="eyebrow">A股 ETF 策略工厂</p>
            <h1>{config.name}</h1>
            <p className="subtitle">{config.description}</p>
          </div>
          <div className="status-stack" aria-label="策略状态">
            <span>
              <Activity size={16} />
              {result.latestSignal.date}
            </span>
            <span>数据截至 {dataLatestDate}</span>
            <span>{isDemoDataset ? "演示数据" : dataset.source}</span>
            <span>ETF {symbolCoverage}</span>
            <span>{config.kind === "composite" ? "组合策略" : "基础策略"}</span>
            <strong>{result.latestSignal.holdings.length} 个持仓</strong>
          </div>
        </div>
      </header>

      <nav className="tab-bar" aria-label="平台导航">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              className={activeTab === tab.key ? "tab-button active" : "tab-button"}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="workspace">
        {activeTab === "overview" && (
          <Dashboard result={result} config={config}>
            <BacktestCharts result={result} />
          </Dashboard>
        )}
        {activeTab === "lab" && (
          <StrategyLab
            config={config}
            result={result}
            profiles={dataset.profiles}
            strategies={strategies}
            activeStrategyId={activeStrategyId}
            onSelect={setActiveStrategyId}
            onChange={updateActiveStrategy}
            onCreateBase={createBaseStrategy}
            onCreateComposite={createCompositeStrategy}
            onDuplicate={duplicateActiveStrategy}
            onDelete={deleteActiveStrategy}
          />
        )}
        {activeTab === "factors" && <FactorLibrary config={config} />}
        {activeTab === "signals" && <SignalPanel result={result} />}
      </div>
    </main>
  );
}
