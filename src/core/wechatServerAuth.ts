export interface WeChatServerEnv {
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
}

export interface WeChatAccountProfile {
  id: string;
  provider: "wechat";
  displayName: string;
  avatarUrl?: string;
}

export interface ExchangeWeChatCodeInput {
  appId: string;
  appSecret: string;
  code: string;
  fetcher?: typeof fetch;
}

interface WeChatErrorPayload {
  errcode?: unknown;
  errmsg?: unknown;
}

interface AccessTokenPayload extends WeChatErrorPayload {
  access_token?: unknown;
  openid?: unknown;
  unionid?: unknown;
}

interface UserInfoPayload extends WeChatErrorPayload {
  openid?: unknown;
  unionid?: unknown;
  nickname?: unknown;
  headimgurl?: unknown;
}

export function missingWeChatServerConfig(env: WeChatServerEnv): string[] {
  const missing: string[] = [];
  if (!env.WECHAT_APP_ID) {
    missing.push("WECHAT_APP_ID");
  }
  if (!env.WECHAT_APP_SECRET) {
    missing.push("WECHAT_APP_SECRET");
  }
  return missing;
}

function assertNoWeChatError(payload: WeChatErrorPayload): void {
  if (typeof payload.errcode === "number" && payload.errcode !== 0) {
    throw new Error(
      typeof payload.errmsg === "string"
        ? payload.errmsg
        : `WeChat API error ${payload.errcode}`
    );
  }
}

async function readWeChatJson<T extends WeChatErrorPayload>(
  response: Response,
  label: string
): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as T;
  assertNoWeChatError(payload);
  return payload;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function exchangeWeChatCodeForAccount({
  appId,
  appSecret,
  code,
  fetcher = fetch
}: ExchangeWeChatCodeInput): Promise<WeChatAccountProfile> {
  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.searchParams.set("appid", appId);
  tokenUrl.searchParams.set("secret", appSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("grant_type", "authorization_code");

  const tokenPayload = await readWeChatJson<AccessTokenPayload>(
    await fetcher(tokenUrl),
    "WeChat access_token"
  );
  const accessToken = stringField(tokenPayload.access_token);
  const openid = stringField(tokenPayload.openid);

  if (!accessToken || !openid) {
    throw new Error("WeChat access_token response is missing access_token or openid");
  }

  const userInfoUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  userInfoUrl.searchParams.set("access_token", accessToken);
  userInfoUrl.searchParams.set("openid", openid);
  userInfoUrl.searchParams.set("lang", "zh_CN");

  const userInfo = await readWeChatJson<UserInfoPayload>(
    await fetcher(userInfoUrl),
    "WeChat userinfo"
  );
  const unionid = stringField(userInfo.unionid) ?? stringField(tokenPayload.unionid);
  const stableId = unionid ?? stringField(userInfo.openid) ?? openid;
  const nickname = stringField(userInfo.nickname) ?? "微信用户";

  return {
    id: `wechat-${stableId}`,
    provider: "wechat",
    displayName: nickname,
    avatarUrl: stringField(userInfo.headimgurl)
  };
}
