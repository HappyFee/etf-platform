import { afterEach, describe, expect, test, vi } from "vitest";
import handler from "./wechat";

function createResponse() {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end() {
      this.ended = true;
    },
    header(name: string) {
      return headers.get(name.toLowerCase());
    }
  };
  return response;
}

describe("wechat auth api", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("rejects non-POST requests", async () => {
    const res = createResponse();

    await handler({ method: "GET" }, res);

    expect(res.statusCode).toBe(405);
    expect(res.payload).toEqual({ error: "method_not_allowed" });
  });

  test("reports missing server env vars", async () => {
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    const res = createResponse();

    await handler({ method: "POST", body: { code: "oauth-code" } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({
      error: "wechat_not_configured",
      missing: ["WECHAT_APP_ID", "WECHAT_APP_SECRET"]
    });
  });

  test("returns a normalized account for a valid OAuth code", async () => {
    process.env.WECHAT_APP_ID = "wx-app";
    process.env.WECHAT_APP_SECRET = "secret";
    globalThis.fetch = vi.fn(async (url: string | URL) => {
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
    }) as typeof fetch;
    const res = createResponse();

    await handler({ method: "POST", body: { code: "oauth-code" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      id: "wechat-union-1",
      provider: "wechat",
      displayName: "ETF User",
      avatarUrl: "https://example.com/avatar.png"
    });
    expect(res.header("cache-control")).toBe("no-store");
  });
});
