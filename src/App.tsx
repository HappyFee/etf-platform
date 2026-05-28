import { Activity, BarChart3, BellRing, LibraryBig, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BacktestCharts } from "./components/BacktestCharts";
import { Dashboard } from "./components/Dashboard";
import { FactorLibrary } from "./components/FactorLibrary";
import { SignalPanel } from "./components/SignalPanel";
import { StrategyLab } from "./components/StrategyLab";
import { defaultStrategy } from "./core/defaultStrategy";
import { runBacktest } from "./core/backtest";
import { loadGeneratedDataset, sampleDataset } from "./core/dataSource";
import type { StrategyConfig } from "./core/types";

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

function cloneDefaultStrategy(): StrategyConfig {
  return JSON.parse(JSON.stringify(defaultStrategy)) as StrategyConfig;
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [config, setConfig] = useState<StrategyConfig>(cloneDefaultStrategy);
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

  const result = useMemo(
    () => runBacktest({ bars: dataset.bars, profiles: dataset.profiles, config }),
    [config, dataset]
  );

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
            <span>{dataset.source}</span>
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
            onChange={setConfig}
            onReset={() => setConfig(cloneDefaultStrategy())}
          />
        )}
        {activeTab === "factors" && <FactorLibrary config={config} />}
        {activeTab === "signals" && <SignalPanel result={result} />}
      </div>
    </main>
  );
}
