import { describe, expect, test } from "vitest";
import { defaultStrategies, defaultStrategy, defensiveStrategy } from "./defaultStrategy";
import {
  createMemoryStorage,
  loadAccountWorkspace,
  saveAccountWorkspace
} from "./accountStorage";

describe("account strategy storage", () => {
  test("keeps strategies isolated by account id", () => {
    const storage = createMemoryStorage();

    saveAccountWorkspace(storage, "wechat-a", {
      strategies: [
        {
          ...defaultStrategy,
          name: "Account A rotation"
        }
      ],
      activeStrategyId: defaultStrategy.id
    });
    saveAccountWorkspace(storage, "wechat-b", {
      strategies: [
        {
          ...defensiveStrategy,
          name: "Account B defensive"
        }
      ],
      activeStrategyId: defensiveStrategy.id
    });

    expect(loadAccountWorkspace(storage, "wechat-a")?.strategies[0].name).toBe(
      "Account A rotation"
    );
    expect(loadAccountWorkspace(storage, "wechat-b")?.strategies[0].name).toBe(
      "Account B defensive"
    );
  });

  test("falls back to defaults when an account has no saved workspace", () => {
    const storage = createMemoryStorage();
    const workspace = loadAccountWorkspace(storage, "new-account");

    expect(workspace?.strategies).toEqual(defaultStrategies);
    expect(workspace?.activeStrategyId).toBe(defaultStrategy.id);
  });
});
