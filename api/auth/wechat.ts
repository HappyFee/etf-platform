import {
  exchangeWeChatCodeForAccount,
  missingWeChatServerConfig
} from "../../src/core/wechatServerAuth";

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(payload: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

function stringBodyField(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const missing = missingWeChatServerConfig(process.env);
  if (missing.length > 0) {
    res.status(500).json({
      error: "wechat_not_configured",
      missing
    });
    return;
  }

  const code = stringBodyField(req.body, "code");
  if (!code) {
    res.status(400).json({ error: "missing_code" });
    return;
  }

  try {
    const account = await exchangeWeChatCodeForAccount({
      appId: process.env.WECHAT_APP_ID!,
      appSecret: process.env.WECHAT_APP_SECRET!,
      code
    });

    res.status(200).json(account);
  } catch (error) {
    res.status(502).json({
      error: "wechat_exchange_failed",
      message: error instanceof Error ? error.message : "Unknown WeChat error"
    });
  }
}
