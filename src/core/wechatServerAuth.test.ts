import { describe, expect, test } from "vitest";
import {
  exchangeWeChatCodeForAccount,
  missingWeChatServerConfig
} from "./wechatServerAuth";

describe("wechat server auth", () => {
  test("exchanges an OAuth code for a normalized account profile", async () => {
    const requestedUrls: string[] = [];
    const account = await exchangeWeChatCodeForAccount({
      appId: "wx-app",
      appSecret: "secret",
      code: "oauth-code",
      fetcher: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).includes("/sns/oauth2/access_token")) {
          return {
            ok: true,
            json: async () => ({
              access_token: "token",
              openid: "openid-1",
              unionid: "union-1"
            })
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({
            openid: "openid-1",
            unionid: "union-1",
            nickname: "ETF User",
            headimgurl: "https://example.com/avatar.png"
          })
        } as Response;
      }
    });

    expect(requestedUrls[0]).toContain("appid=wx-app");
    expect(requestedUrls[0]).toContain("secret=secret");
    expect(requestedUrls[0]).toContain("code=oauth-code");
    expect(requestedUrls[1]).toContain("access_token=token");
    expect(requestedUrls[1]).toContain("openid=openid-1");
    expect(account).toEqual({
      id: "wechat-union-1",
      provider: "wechat",
      displayName: "ETF User",
      avatarUrl: "https://example.com/avatar.png"
    });
  });

  test("reports WeChat API errors", async () => {
    await expect(
      exchangeWeChatCodeForAccount({
        appId: "wx-app",
        appSecret: "secret",
        code: "bad-code",
        fetcher: async () =>
          ({
            ok: true,
            json: async () => ({
              errcode: 40029,
              errmsg: "invalid code"
            })
          }) as Response
      })
    ).rejects.toThrow("invalid code");
  });

  test("detects missing server configuration", () => {
    expect(
      missingWeChatServerConfig({
        WECHAT_APP_ID: "wx-app"
      })
    ).toEqual(["WECHAT_APP_SECRET"]);
  });
});
