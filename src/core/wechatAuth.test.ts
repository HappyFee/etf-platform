import { describe, expect, test } from "vitest";
import {
  buildWeChatAuthorizeUrl,
  createMockWeChatAccount,
  exchangeWeChatCode,
  resolveWeChatLoginConfig
} from "./wechatAuth";

describe("wechat auth adapter", () => {
  test("builds a website QR authorize URL with state", () => {
    const url = buildWeChatAuthorizeUrl({
      appId: "wx123",
      redirectUri: "https://example.com/login/callback",
      state: "csrf-state"
    });

    expect(url.origin).toBe("https://open.weixin.qq.com");
    expect(url.pathname).toBe("/connect/qrconnect");
    expect(url.searchParams.get("appid")).toBe("wx123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/login/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("snsapi_login");
    expect(url.searchParams.get("state")).toBe("csrf-state");
    expect(url.hash).toBe("#wechat_redirect");
  });

  test("uses mock login when app id is not configured", () => {
    expect(resolveWeChatLoginConfig({}).mode).toBe("mock");
    const config = resolveWeChatLoginConfig({ VITE_WECHAT_APP_ID: "wx123" });
    expect(config.mode).toBe("oauth");
    expect(config.mode === "oauth" ? config.loginApi : "").toBe("/api/auth/wechat");
  });

  test("creates stable local mock accounts by label", () => {
    const first = createMockWeChatAccount("alice");
    const second = createMockWeChatAccount("alice");
    const third = createMockWeChatAccount("bob");

    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(third.id);
    expect(first.provider).toBe("wechat");
  });

  test("exchanges a callback code through a backend endpoint", async () => {
    const account = await exchangeWeChatCode(
      async (_url, init) => {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          code: "oauth-code",
          state: "csrf-state"
        });
        return {
          ok: true,
          json: async () => ({
            id: "wechat-openid",
            provider: "wechat",
            displayName: "Real WeChat"
          })
        } as Response;
      },
      "/api/auth/wechat",
      "oauth-code",
      "csrf-state"
    );

    expect(account.displayName).toBe("Real WeChat");
  });
});
