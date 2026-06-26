import { defaultStrategies, defaultStrategy } from "./defaultStrategy";
import type { StrategyConfig } from "./types";

const workspacePrefix = "etf-platform:workspace:";
const activeAccountKey = "etf-platform:active-account";

export interface AccountProfile {
  id: string;
  provider: "wechat" | "local";
  displayName: string;
  avatarUrl?: string;
}

export interface AccountWorkspace {
  strategies: StrategyConfig[];
  activeStrategyId: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function cloneStrategy<T extends StrategyConfig>(strategy: T): T {
  return JSON.parse(JSON.stringify(strategy)) as T;
}

function defaultWorkspace(): AccountWorkspace {
  return {
    strategies: defaultStrategies.map(cloneStrategy),
    activeStrategyId: defaultStrategy.id
  };
}

function workspaceKey(accountId: string): string {
  return `${workspacePrefix}${accountId}`;
}

function isStrategyList(value: unknown): value is StrategyConfig[] {
  return Array.isArray(value) && value.every((item) => {
    const strategy = item as Partial<StrategyConfig>;
    return (
      typeof strategy?.id === "string" &&
      typeof strategy.name === "string" &&
      (strategy.kind === "base" || strategy.kind === "composite")
    );
  });
}

export function loadAccountWorkspace(
  storage: StorageLike,
  accountId: string
): AccountWorkspace {
  const fallback = defaultWorkspace();
  const raw = storage.getItem(workspaceKey(accountId));

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AccountWorkspace>;
    if (!isStrategyList(parsed.strategies)) {
      return fallback;
    }

    const activeStrategyId =
      typeof parsed.activeStrategyId === "string" &&
      parsed.strategies.some((strategy) => strategy.id === parsed.activeStrategyId)
        ? parsed.activeStrategyId
        : parsed.strategies[0]?.id ?? fallback.activeStrategyId;

    return {
      strategies: parsed.strategies,
      activeStrategyId
    };
  } catch {
    return fallback;
  }
}

export function saveAccountWorkspace(
  storage: StorageLike,
  accountId: string,
  workspace: AccountWorkspace
): void {
  storage.setItem(workspaceKey(accountId), JSON.stringify(workspace));
}

export function loadActiveAccount(storage: StorageLike): AccountProfile | null {
  const raw = storage.getItem(activeAccountKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AccountProfile>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.displayName !== "string" ||
      (parsed.provider !== "wechat" && parsed.provider !== "local")
    ) {
      return null;
    }

    return {
      id: parsed.id,
      provider: parsed.provider,
      displayName: parsed.displayName,
      avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : undefined
    };
  } catch {
    return null;
  }
}

export function saveActiveAccount(storage: StorageLike, account: AccountProfile): void {
  storage.setItem(activeAccountKey, JSON.stringify(account));
}

export function clearActiveAccount(storage: StorageLike): void {
  storage.removeItem(activeAccountKey);
}
