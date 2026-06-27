import type { AccountProfile } from "./accountStorage";

export interface WeChatAuthorizeInput {
  appId: string;
  redirectUri: string;
  state: string;
}

export interface WeChatEnv {
  VITE_WECHAT_APP_ID?: string;
  VITE_WECHAT_REDIRECT_URI?: string;
  VITE_WECHAT_LOGIN_API?: string;
}

export type WeChatLoginConfig =
  | {
      mode: "oauth";
      appId: string;
      redirectUri: string;
      loginApi?: string;
    }
  | {
      mode: "mock";
    };

export function buildWeChatAuthorizeUrl(input: WeChatAuthorizeInput): URL {
  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.searchParams.set("appid", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_login");
  url.searchParams.set("state", input.state);
  url.hash = "wechat_redirect";
  return url;
}

export function resolveWeChatLoginConfig(env: WeChatEnv): WeChatLoginConfig {
  if (!env.VITE_WECHAT_APP_ID) {
    return { mode: "mock" };
  }

  return {
    mode: "oauth",
    appId: env.VITE_WECHAT_APP_ID,
    redirectUri:
      env.VITE_WECHAT_REDIRECT_URI ??
      (typeof window === "undefined" ? "/" : window.location.href),
    loginApi: env.VITE_WECHAT_LOGIN_API ?? "/api/auth/wechat"
  };
}

function stableHash(value: string): string {
  let hash = 5381;
  for (const character of value) {
    hash = (hash * 33) ^ character.charCodeAt(0);
  }
  return (hash >>> 0).toString(36);
}

export function createMockWeChatAccount(label: string): AccountProfile {
  const normalized = label.trim() || "default";
  return {
    id: `wechat-local-${stableHash(normalized.toLowerCase())}`,
    provider: "wechat",
    displayName: `微信用户 ${normalized}`
  };
}

function isAccountProfile(value: unknown): value is AccountProfile {
  const item = value as Partial<AccountProfile>;
  return (
    typeof item?.id === "string" &&
    typeof item.displayName === "string" &&
    (item.provider === "wechat" || item.provider === "local")
  );
}

export async function exchangeWeChatCode(
  fetcher: typeof fetch,
  endpoint: string,
  code: string,
  state: string
): Promise<AccountProfile> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ code, state })
  });

  if (!response.ok) {
    throw new Error(`WeChat login failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!isAccountProfile(payload)) {
    throw new Error("WeChat login endpoint returned an invalid account");
  }

  return {
    id: payload.id,
    provider: payload.provider,
    displayName: payload.displayName,
    avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined
  };
}

export function createWeChatState(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
