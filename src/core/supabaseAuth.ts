import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountProfile, AccountWorkspace } from "./accountStorage";
import type { StrategyConfig } from "./types";

const workspaceTable = "strategy_workspaces";

export interface SupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export type SupabaseLoginConfig =
  | {
      mode: "enabled";
      url: string;
      publishableKey: string;
    }
  | {
      mode: "disabled";
    };

export interface SupabaseUserLike {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

interface WorkspaceRow {
  strategies: unknown;
  active_strategy_id: unknown;
}

interface WorkspaceUpsertRow {
  user_id: string;
  strategies: StrategyConfig[];
  active_strategy_id: string;
}

interface QueryResult<T> {
  data: T | null;
  error: unknown;
}

export interface SupabaseWorkspaceLoadClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<QueryResult<WorkspaceRow>>;
      };
    };
  };
}

export interface SupabaseWorkspaceSaveClient {
  from(table: string): {
    upsert(row: WorkspaceUpsertRow): Promise<{ error: unknown }>;
  };
}

export function resolveSupabaseConfig(env: SupabaseEnv): SupabaseLoginConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return { mode: "disabled" };
  }

  return {
    mode: "enabled",
    url,
    publishableKey
  };
}

export function createSupabaseBrowserClient(
  config: Extract<SupabaseLoginConfig, { mode: "enabled" }>
): SupabaseClient {
  return createClient(config.url, config.publishableKey);
}

function stringMetadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function accountFromSupabaseUser(user: SupabaseUserLike): AccountProfile {
  const displayName =
    stringMetadataValue(user.user_metadata, "full_name") ??
    stringMetadataValue(user.user_metadata, "name") ??
    user.email ??
    "Supabase 用户";
  const avatarUrl = stringMetadataValue(user.user_metadata, "avatar_url") ?? undefined;

  return {
    id: `supabase-${user.id}`,
    provider: "supabase",
    displayName,
    avatarUrl
  };
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

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return new Error(message);
    }
  }

  return new Error("Supabase request failed");
}

export async function loadSupabaseWorkspace(
  client: SupabaseWorkspaceLoadClient,
  userId: string
): Promise<AccountWorkspace | null> {
  const { data, error } = await client
    .from(workspaceTable)
    .select("strategies, active_strategy_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw toError(error);
  }

  if (!data || !isStrategyList(data.strategies)) {
    return null;
  }

  const activeStrategyId =
    typeof data.active_strategy_id === "string" &&
    data.strategies.some((strategy) => strategy.id === data.active_strategy_id)
      ? data.active_strategy_id
      : data.strategies[0]?.id;

  if (!activeStrategyId) {
    return null;
  }

  return {
    strategies: data.strategies,
    activeStrategyId
  };
}

export async function saveSupabaseWorkspace(
  client: SupabaseWorkspaceSaveClient,
  userId: string,
  workspace: AccountWorkspace
): Promise<void> {
  const { error } = await client.from(workspaceTable).upsert({
    user_id: userId,
    strategies: workspace.strategies,
    active_strategy_id: workspace.activeStrategyId
  });

  if (error) {
    throw toError(error);
  }
}
