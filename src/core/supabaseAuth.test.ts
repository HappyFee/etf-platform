import { describe, expect, test } from "vitest";
import { defaultStrategies } from "./defaultStrategy";
import {
  accountFromSupabaseUser,
  loadSupabaseWorkspace,
  resolveSupabaseConfig,
  saveSupabaseWorkspace
} from "./supabaseAuth";

describe("supabase auth adapter", () => {
  test("enables auth only when both public Supabase env vars are present", () => {
    expect(resolveSupabaseConfig({}).mode).toBe("disabled");
    expect(
      resolveSupabaseConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co"
      }).mode
    ).toBe("disabled");

    expect(
      resolveSupabaseConfig({
        VITE_SUPABASE_URL: " https://example.supabase.co ",
        VITE_SUPABASE_PUBLISHABLE_KEY: " publishable-key "
      })
    ).toEqual({
      mode: "enabled",
      url: "https://example.supabase.co",
      publishableKey: "publishable-key"
    });
  });

  test("maps a Supabase user to an account profile", () => {
    expect(
      accountFromSupabaseUser({
        id: "user-1",
        email: "owner@example.com",
        user_metadata: {
          full_name: "ETF Owner",
          avatar_url: "https://example.com/avatar.png"
        }
      })
    ).toEqual({
      id: "supabase-user-1",
      provider: "supabase",
      displayName: "ETF Owner",
      avatarUrl: "https://example.com/avatar.png"
    });
  });

  test("loads a cloud workspace and repairs an invalid active strategy id", async () => {
    const calls: string[] = [];
    const client = {
      from(table: string) {
        calls.push(`from:${table}`);
        return {
          select(columns: string) {
            calls.push(`select:${columns}`);
            return this;
          },
          eq(column: string, value: string) {
            calls.push(`eq:${column}:${value}`);
            return this;
          },
          maybeSingle: async () => ({
            data: {
              strategies: defaultStrategies,
              active_strategy_id: "missing"
            },
            error: null
          })
        };
      }
    };

    await expect(loadSupabaseWorkspace(client, "user-1")).resolves.toEqual({
      strategies: defaultStrategies,
      activeStrategyId: defaultStrategies[0].id
    });
    expect(calls).toEqual([
      "from:strategy_workspaces",
      "select:strategies, active_strategy_id",
      "eq:user_id:user-1"
    ]);
  });

  test("saves a workspace with an upsert scoped to the Supabase user", async () => {
    const upserts: unknown[] = [];
    const workspace = {
      strategies: defaultStrategies,
      activeStrategyId: defaultStrategies[0].id
    };
    const client = {
      from(table: string) {
        return {
          upsert: async (row: unknown) => {
            upserts.push({ table, row });
            return { error: null };
          }
        };
      }
    };

    await saveSupabaseWorkspace(client, "user-1", workspace);

    expect(upserts).toEqual([
      {
        table: "strategy_workspaces",
        row: {
          user_id: "user-1",
          strategies: defaultStrategies,
          active_strategy_id: defaultStrategies[0].id
        }
      }
    ]);
  });
});
