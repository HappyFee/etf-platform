import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  ChevronDown,
  Database,
  Layers3,
  LibraryBig,
  LogOut,
  Mail,
  MessageCircle,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BacktestCharts } from "./components/BacktestCharts";
import { Dashboard } from "./components/Dashboard";
import { FactorLibrary } from "./components/FactorLibrary";
import { SignalPanel } from "./components/SignalPanel";
import { StrategyLab } from "./components/StrategyLab";
import { buildDataQualityReport, buildRobustnessReport } from "./core/analysis";
import { defaultStrategies, defaultStrategy, defaultCompositeStrategy } from "./core/defaultStrategy";
import { runBacktest } from "./core/backtest";
import { loadGeneratedDataset, sampleDataset } from "./core/dataSource";
import {
  clearActiveAccount,
  loadAccountWorkspace,
  loadActiveAccount,
  saveAccountWorkspace,
  saveActiveAccount,
  type AccountProfile,
  type StorageLike
} from "./core/accountStorage";
import {
  buildWeChatAuthorizeUrl,
  createMockWeChatAccount,
  createWeChatState,
  exchangeWeChatCode,
  resolveWeChatLoginConfig
} from "./core/wechatAuth";
import {
  accountFromSupabaseUser,
  createSupabaseBrowserClient,
  loadSupabaseWorkspace,
  resolveSupabaseConfig,
  saveSupabaseWorkspace,
  type SupabaseUserLike,
  type SupabaseWorkspaceLoadClient,
  type SupabaseWorkspaceSaveClient
} from "./core/supabaseAuth";
import type { BaseStrategyConfig, CompositeStrategyConfig, StrategyConfig } from "./core/types";

type TabKey = "overview" | "lab" | "factors" | "signals";
type DataLoadStatus = "loading" | "loaded" | "failed";
type SupabaseStatus = "idle" | "sending" | "sent" | "syncing";
type WorkspaceSaveStatus = "saved" | "saving" | "error";

const localAccount: AccountProfile = {
  id: "local-default",
  provider: "local",
  displayName: "本地账号"
};
const weChatStateKey = "etf-platform:wechat-oauth-state";

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

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function initialAccount(storage: StorageLike | null): AccountProfile {
  return storage ? loadActiveAccount(storage) ?? localAccount : localAccount;
}

function initialWorkspace(storage: StorageLike | null, account: AccountProfile) {
  return storage
    ? loadAccountWorkspace(storage, account.id)
    : {
        strategies: defaultStrategies.map(cloneStrategy),
        activeStrategyId: defaultStrategy.id
      };
}

export function DataSourceNotice({
  generatedUrl,
  loadStatus
}: {
  generatedUrl: string;
  loadStatus: DataLoadStatus;
}) {
  if (loadStatus !== "failed") {
    return null;
  }

  return (
    <div className="data-source-notice" data-testid="data-source-notice" role="status">
      <AlertTriangle size={16} />
      <span>
        真实行情数据加载失败，当前使用演示数据。请检查生成文件是否可访问：{generatedUrl}
      </span>
    </div>
  );
}

export function AccountPanel({
  account,
  isOAuthConfigured,
  isSupabaseConfigured = false,
  onWeChatLogin,
  onLocalLogin,
  onLogout,
  onSupabaseEmailChange = () => undefined,
  onSupabaseLogin = () => undefined,
  supabaseEmail = "",
  supabaseStatus = "idle",
  workspaceSaveStatus = "saved"
}: {
  account: AccountProfile;
  isOAuthConfigured: boolean;
  isSupabaseConfigured?: boolean;
  onWeChatLogin: () => void;
  onLocalLogin: () => void;
  onLogout: () => void;
  onSupabaseEmailChange?: (email: string) => void;
  onSupabaseLogin?: () => void;
  supabaseEmail?: string;
  supabaseStatus?: SupabaseStatus;
  workspaceSaveStatus?: WorkspaceSaveStatus;
}) {
  const providerLabel =
    account.provider === "supabase"
      ? "Supabase 云端账号"
      : account.provider === "wechat"
        ? isOAuthConfigured
          ? "微信账号"
          : "微信模拟账号"
        : "本地账号";
  const avatarLabel =
    account.provider === "supabase" ? "云" : account.provider === "wechat" ? "微" : "本";
  const supabaseBusy = supabaseStatus === "sending" || supabaseStatus === "syncing";
  const supabaseButtonLabel =
    supabaseStatus === "sending"
      ? "发送中"
      : supabaseStatus === "sent"
        ? "已发送"
        : supabaseStatus === "syncing"
          ? "同步中"
          : "邮箱登录";
  const saveLabel =
    workspaceSaveStatus === "saving"
      ? "保存中..."
      : workspaceSaveStatus === "error"
        ? "保存失败"
        : account.provider === "supabase"
          ? "云端已保存"
          : "已保存到本机";

  return (
    <details className="account-panel" data-testid="account-panel">
      <summary className="account-panel__summary">
        <span className="account-panel__identity">
          <span className="account-avatar">{avatarLabel}</span>
          <span className="account-panel__name">
            <strong>{account.displayName}</strong>
            <small>
              {providerLabel} · {saveLabel}
            </small>
          </span>
        </span>
        <span className="account-panel__toggle">
          账号
          <ChevronDown size={16} />
        </span>
      </summary>
      <div className="account-panel__body">
        <div className="account-panel__actions">
          <button className="text-action" onClick={onWeChatLogin} type="button">
            <MessageCircle size={16} />
            微信登录
          </button>
          <button className="text-action" onClick={onLocalLogin} type="button">
            本地账号
          </button>
          <button className="icon-action" onClick={onLogout} title="退出当前账号" type="button">
            <LogOut size={16} />
          </button>
        </div>
        <form
          className="account-panel__auth"
          onSubmit={(event) => {
            event.preventDefault();
            onSupabaseLogin();
          }}
        >
          <label className="account-panel__email">
            <Mail size={15} />
            <input
              aria-label="邮箱地址"
              data-testid="supabase-email-input"
              disabled={!isSupabaseConfigured || supabaseBusy}
              onChange={(event) => onSupabaseEmailChange(event.target.value)}
              placeholder={isSupabaseConfigured ? "输入邮箱获取登录链接" : "未配置 Supabase"}
              type="email"
              value={supabaseEmail}
            />
          </label>
          <button
            className="text-action"
            data-testid="supabase-login-button"
            disabled={!isSupabaseConfigured || supabaseBusy}
            type="submit"
          >
            {supabaseButtonLabel}
          </button>
        </form>
      </div>
    </details>
  );
}

export function App() {
  const storage = useMemo(() => browserStorage(), []);
  const [account, setAccount] = useState<AccountProfile>(() => initialAccount(storage));
  const initial = useMemo(() => initialWorkspace(storage, account), [storage]);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [strategies, setStrategies] = useState<StrategyConfig[]>(
    initial.strategies
  );
  const [activeStrategyId, setActiveStrategyId] = useState(initial.activeStrategyId);
  const [dataset, setDataset] = useState(sampleDataset);
  const [dataLoadStatus, setDataLoadStatus] = useState<DataLoadStatus>("loading");
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [supabaseEmail, setSupabaseEmail] = useState("");
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus>("idle");
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [cloudWorkspaceUserId, setCloudWorkspaceUserId] = useState<string | null>(null);
  const [workspaceSaveStatus, setWorkspaceSaveStatus] =
    useState<WorkspaceSaveStatus>("saved");
  const cloudSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const generatedUrl = `${import.meta.env.BASE_URL}data/a-share-etf-bars.generated.json`;
  const weChatConfig = useMemo(
    () =>
      resolveWeChatLoginConfig({
        VITE_WECHAT_APP_ID: import.meta.env.VITE_WECHAT_APP_ID,
        VITE_WECHAT_REDIRECT_URI: import.meta.env.VITE_WECHAT_REDIRECT_URI,
        VITE_WECHAT_LOGIN_API: import.meta.env.VITE_WECHAT_LOGIN_API
      }),
    []
  );
  const isWeChatOAuthConfigured = weChatConfig.mode === "oauth";
  const supabaseConfig = useMemo(
    () =>
      resolveSupabaseConfig({
        VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      }),
    []
  );
  const supabase = useMemo(
    () =>
      supabaseConfig.mode === "enabled"
        ? createSupabaseBrowserClient(supabaseConfig)
        : null,
    [supabaseConfig]
  );
  const isSupabaseConfigured = supabaseConfig.mode === "enabled";

  useEffect(() => {
    let cancelled = false;

    loadGeneratedDataset(fetch, generatedUrl).then((generatedDataset) => {
      if (cancelled) {
        return;
      }

      if (generatedDataset) {
        setDataset(generatedDataset);
        setDataLoadStatus("loaded");
      } else {
        setDataLoadStatus("failed");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [generatedUrl]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;
    setSupabaseStatus("syncing");

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) {
          return;
        }

        if (error) {
          setSupabaseStatus("idle");
          setAccountNotice(error.message);
          return;
        }

        if (data.session?.user) {
          void activateSupabaseUser(data.session.user);
        } else {
          setSupabaseStatus("idle");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setSupabaseStatus("idle");
        setAccountNotice(error instanceof Error ? error.message : "Supabase session 初始化失败");
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        void activateSupabaseUser(session.user);
        return;
      }

      if (event === "SIGNED_OUT") {
        setSupabaseUserId(null);
        setCloudWorkspaceUserId(null);
        setSupabaseStatus("idle");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (typeof window === "undefined" || weChatConfig.mode !== "oauth") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state") ?? "";

    if (!code) {
      return;
    }

    const expectedState = window.sessionStorage.getItem(weChatStateKey);
    if (!expectedState || expectedState !== state) {
      setAccountNotice("微信登录 state 校验失败，请重新发起登录。");
      return;
    }

    if (!weChatConfig.loginApi) {
      setAccountNotice("微信已返回授权 code，但未配置 VITE_WECHAT_LOGIN_API，无法安全完成登录。");
      return;
    }

    let cancelled = false;
    exchangeWeChatCode(fetch, weChatConfig.loginApi, code, state)
      .then((nextAccount) => {
        if (cancelled) {
          return;
        }
        switchAccount(nextAccount);
        window.sessionStorage.removeItem(weChatStateKey);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("code");
        cleanUrl.searchParams.delete("state");
        window.history.replaceState({}, "", cleanUrl.toString());
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setAccountNotice(error instanceof Error ? error.message : "微信登录失败");
      });

    return () => {
      cancelled = true;
    };
  }, [weChatConfig]);

  useEffect(() => {
    if (!storage) {
      return;
    }

    saveActiveAccount(storage, account);
    saveAccountWorkspace(storage, account.id, {
      strategies,
      activeStrategyId
    });
    if (account.provider !== "supabase") {
      setWorkspaceSaveStatus("saved");
    }
  }, [account, activeStrategyId, storage, strategies]);

  useEffect(() => {
    if (
      !supabase ||
      account.provider !== "supabase" ||
      !supabaseUserId ||
      cloudWorkspaceUserId !== supabaseUserId
    ) {
      return;
    }

    let cancelled = false;
    setWorkspaceSaveStatus("saving");
    const saveTimer = window.setTimeout(() => {
      cloudSaveQueue.current = cloudSaveQueue.current
        .catch(() => undefined)
        .then(() =>
          saveSupabaseWorkspace(
            supabase as unknown as SupabaseWorkspaceSaveClient,
            supabaseUserId,
            { strategies, activeStrategyId }
          )
        );
      cloudSaveQueue.current
        .then(() => {
          if (!cancelled) {
            setWorkspaceSaveStatus("saved");
          }
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          setWorkspaceSaveStatus("error");
          setAccountNotice(error instanceof Error ? error.message : "Supabase 策略保存失败");
        });
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(saveTimer);
    };
  }, [account.provider, activeStrategyId, cloudWorkspaceUserId, strategies, supabase, supabaseUserId]);

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
  const dataQuality = useMemo(
    () => buildDataQualityReport(dataset.bars, dataset.profiles),
    [dataset]
  );
  const robustness = useMemo(
    () =>
      buildRobustnessReport({
        bars: dataset.bars,
        profiles: dataset.profiles,
        config,
        strategyBook: strategies
      }),
    [config, dataset, strategies]
  );
  const isDemoDataset = dataset.source.startsWith("demo");
  const symbolCoverage =
    dataset.requestedSymbols?.length && dataset.succeededSymbols?.length
      ? `${dataset.succeededSymbols.length}/${dataset.requestedSymbols.length}`
      : `${dataset.profiles.length}`;

  async function activateSupabaseUser(user: SupabaseUserLike) {
    if (!supabase) {
      return;
    }

    const nextAccount = accountFromSupabaseUser(user);
    setSupabaseStatus("syncing");
    setWorkspaceSaveStatus("saving");
    setSupabaseUserId(user.id);
    setCloudWorkspaceUserId(null);
    if (user.email) {
      setSupabaseEmail(user.email);
    }

    let nextWorkspace = storage
      ? loadAccountWorkspace(storage, nextAccount.id)
      : initialWorkspace(storage, nextAccount);

    try {
      const cloudWorkspace = await loadSupabaseWorkspace(
        supabase as unknown as SupabaseWorkspaceLoadClient,
        user.id
      );
      if (cloudWorkspace) {
        nextWorkspace = cloudWorkspace;
      }
    } catch (error) {
      setAccountNotice(error instanceof Error ? error.message : "Supabase 策略加载失败");
    }

    setAccount(nextAccount);
    setStrategies(nextWorkspace.strategies);
    setActiveStrategyId(nextWorkspace.activeStrategyId);
    setActiveTab("lab");
    setCloudWorkspaceUserId(user.id);
    setSupabaseStatus("idle");

    if (storage) {
      saveActiveAccount(storage, nextAccount);
      saveAccountWorkspace(storage, nextAccount.id, nextWorkspace);
    }
  }

  function persistCurrentWorkspace() {
    if (!storage) {
      return;
    }

    saveAccountWorkspace(storage, account.id, {
      strategies,
      activeStrategyId
    });
  }

  function switchAccount(nextAccount: AccountProfile) {
    persistCurrentWorkspace();

    const nextWorkspace = storage
      ? loadAccountWorkspace(storage, nextAccount.id)
      : initialWorkspace(storage, nextAccount);

    setAccount(nextAccount);
    setStrategies(nextWorkspace.strategies);
    setActiveStrategyId(nextWorkspace.activeStrategyId);
    setActiveTab("lab");
    setWorkspaceSaveStatus("saved");

    if (storage) {
      saveActiveAccount(storage, nextAccount);
    }
  }

  async function signOutSupabaseSession() {
    if (supabase && supabaseUserId) {
      await supabase.auth.signOut();
    }
    setSupabaseUserId(null);
    setCloudWorkspaceUserId(null);
    setSupabaseStatus("idle");
  }

  async function loginWithSupabaseEmail() {
    if (!supabase) {
      setAccountNotice("Supabase 尚未配置，无法发送登录链接。");
      return;
    }

    const email = supabaseEmail.trim();
    if (!email) {
      setAccountNotice("请输入邮箱地址。");
      return;
    }

    setSupabaseStatus("sending");
    const redirectTo =
      typeof window === "undefined"
        ? undefined
        : `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined
    });

    if (error) {
      setSupabaseStatus("idle");
      setAccountNotice(error.message);
      return;
    }

    setSupabaseStatus("sent");
    setAccountNotice("登录链接已发送，请到邮箱中打开。");
  }

  function loginWithLocalAccount() {
    void signOutSupabaseSession();
    switchAccount(localAccount);
  }

  function logoutAccount() {
    persistCurrentWorkspace();
    if (storage) {
      clearActiveAccount(storage);
    }
    void signOutSupabaseSession();
    switchAccount(localAccount);
  }

  function loginWithWeChat() {
    if (weChatConfig.mode === "oauth") {
      const state = createWeChatState();
      window.sessionStorage.setItem(weChatStateKey, state);
      const url = buildWeChatAuthorizeUrl({
        appId: weChatConfig.appId,
        redirectUri: weChatConfig.redirectUri,
        state
      });

      window.location.assign(url.toString());
      return;
    }

    const label =
      window.prompt("输入一个微信账号标识，用于本地模拟多个微信账号", "demo") ??
      "demo";
    switchAccount(createMockWeChatAccount(label));
  }

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
          <div className="top-band__side">
            <div className="status-stack" aria-label="策略状态">
              <span className="status-chip status-chip--primary">
                <Activity size={16} />
                {result.latestSignal.date}
              </span>
              <span className={isDemoDataset ? "status-chip status-chip--warn" : "status-chip"}>
                <Database size={16} />
                数据截至 {dataLatestDate}
              </span>
              <span className="status-chip status-chip--secondary">
                {isDemoDataset ? "演示数据" : dataset.source}
              </span>
              <span className="status-chip status-chip--secondary">ETF {symbolCoverage}</span>
              <span className="status-chip">
                <Layers3 size={16} />
                {config.kind === "composite" ? "组合策略" : "基础策略"}
              </span>
              <strong className="status-chip status-chip--strong">
                {result.latestSignal.holdings.length} 个持仓
              </strong>
            </div>
            <AccountPanel
              account={account}
              isOAuthConfigured={isWeChatOAuthConfigured}
              isSupabaseConfigured={isSupabaseConfigured}
              onLocalLogin={loginWithLocalAccount}
              onLogout={logoutAccount}
              onSupabaseEmailChange={setSupabaseEmail}
              onSupabaseLogin={() => void loginWithSupabaseEmail()}
              onWeChatLogin={loginWithWeChat}
              supabaseEmail={supabaseEmail}
              supabaseStatus={supabaseStatus}
              workspaceSaveStatus={workspaceSaveStatus}
            />
          </div>
        </div>
      </header>

      <DataSourceNotice generatedUrl={generatedUrl} loadStatus={dataLoadStatus} />
      {accountNotice && (
        <div className="data-source-notice" role="status">
          <AlertTriangle size={16} />
          <span>{accountNotice}</span>
        </div>
      )}

      <nav className="tab-bar" aria-label="平台导航">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              className={activeTab === tab.key ? "tab-button active" : "tab-button"}
              aria-current={activeTab === tab.key ? "page" : undefined}
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
          <Dashboard
            result={result}
            config={config}
            dataQuality={dataQuality}
            robustness={robustness}
          >
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
