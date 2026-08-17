import type {
  LarkAppConfigurationInput,
  LarkAuthSnapshot,
  LarkTokenStatus
} from "@pi67/domain";

const DEFAULT_AUTHORIZATION_LIFETIME_MS = 10 * 60_000;
const MAX_AUTHORIZATION_LIFETIME_MS = 30 * 60_000;
const LARK_CONNECTION_HOST_SUFFIXES = [".feishu.cn", ".larksuite.com"] as const;

export function parseConnectionSetupUrl(output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[^\s<>"'，。；！？、）】]+/gu)) {
    const candidate = match[0].replace(/[),.;!?]+$/u, "");
    const url = secureUrl(candidate);
    if (!url) continue;
    const hostname = new URL(url).hostname.toLowerCase();
    if (LARK_CONNECTION_HOST_SUFFIXES.some((suffix) => (
      hostname === suffix.slice(1) || hostname.endsWith(suffix)
    ))) return url;
  }
  return undefined;
}

export function parseLoginStart(stdout: string, now: number): {
  deviceCode: string;
  verificationUrl: string;
  userCode?: string;
  expiresAt: number;
} {
  const root = unwrapData(parseJsonObject(stdout, "LARK_AUTH_LOGIN_INVALID"));
  const deviceCode = boundedString(root.device_code ?? root.deviceCode, 4_096);
  const verificationUrl = secureUrl(
    root.verification_url
      ?? root.verification_uri_complete
      ?? root.verification_uri
      ?? root.verificationUrl
  );
  if (!deviceCode || !verificationUrl) {
    throw new Error("LARK_AUTH_LOGIN_INVALID: lark-cli returned an incomplete Device Flow response.");
  }
  const expiresInSeconds = boundedNumber(root.expires_in ?? root.expiresIn);
  const lifetime = Math.min(
    MAX_AUTHORIZATION_LIFETIME_MS,
    Math.max(60_000, expiresInSeconds === undefined
      ? DEFAULT_AUTHORIZATION_LIFETIME_MS
      : expiresInSeconds * 1_000)
  );
  const userCode = boundedString(root.user_code ?? root.userCode, 64);
  return {
    deviceCode,
    verificationUrl,
    ...(userCode === undefined ? {} : { userCode }),
    expiresAt: now + lifetime
  };
}

export function parseStatus(stdout: string, now: number): LarkAuthSnapshot {
  const root = unwrapData(parseJsonObject(stdout, "LARK_AUTH_STATUS_INVALID"));
  const identities = record(root.identities);
  const user = record(identities.user);
  const app = record(identities.bot);
  const cliReady = root.verified === true || Object.keys(identities).length > 0;
  if (!cliReady) return errorSnapshot(now, "lark-cli 未返回可验证的身份状态。");

  const tokenStatus = normalizeTokenStatus(user.tokenStatus ?? user.token_status);
  const connected = (user.status === "ready" || user.status === "needs_refresh")
    && user.available === true
    && user.verified === true
    && (tokenStatus === "valid" || tokenStatus === "needs-refresh");
  const userName = boundedString(user.userName ?? user.user_name, 200);
  const appName = boundedString(app.appName ?? app.app_name, 200);
  const appId = normalizeAppId(root.appId ?? root.app_id);
  const appBrand = normalizeAppBrand(root.brand);
  const appReady = app.status === "ready" && app.available === true && app.verified === true;
  const tokenExpiresAt = timestamp(user.expiresAt ?? user.expires_at);
  return {
    cliStatus: "ready",
    phase: connected ? "connected" : "disconnected",
    verified: connected,
    checkedAt: now,
    appStatus: appReady ? "ready" : "missing",
    ...(appId === undefined ? {} : { appId }),
    ...(appBrand === undefined ? {} : { appBrand }),
    ...(appName === undefined ? {} : { appName }),
    ...(userName === undefined ? {} : { userName }),
    ...(tokenStatus === undefined ? {} : { tokenStatus }),
    ...(tokenExpiresAt === undefined ? {} : { tokenExpiresAt }),
    detail: connected
      ? tokenStatus === "needs-refresh"
        ? "飞书用户身份可用，访问令牌将在下一次用户 API 调用时自动续期。"
        : "飞书用户授权有效，Lark CLI 与官方办公技能可复用该身份。"
      : "尚未获得有效的飞书用户授权。"
  };
}

export function normalizeApplicationInput(
  input: LarkAppConfigurationInput
): LarkAppConfigurationInput {
  const appId = normalizeAppId(input.appId);
  const appSecret = boundedString(input.appSecret, 512);
  const brand = normalizeAppBrand(input.brand);
  if (!appId || !appSecret || /\s/u.test(appSecret) || !brand) {
    throw new Error("LARK_APP_CONFIGURATION_INVALID: App ID 或 App Secret 格式无效。");
  }
  return { appId, appSecret, brand };
}

export function missingCliSnapshot(now: number): LarkAuthSnapshot {
  return {
    cliStatus: "missing",
    phase: "disconnected",
    verified: false,
    checkedAt: now,
    appStatus: "unknown",
    detail: "未找到 lark-cli，请先安装或修复 Lark CLI。"
  };
}

export function errorSnapshot(now: number, detail: string): LarkAuthSnapshot {
  return {
    cliStatus: "ready",
    phase: "error",
    verified: false,
    checkedAt: now,
    appStatus: "unknown",
    detail
  };
}

function normalizeAppId(value: unknown): string | undefined {
  const appId = boundedString(value, 256);
  return appId && /^cli_[A-Za-z0-9]+$/u.test(appId) ? appId : undefined;
}

function normalizeAppBrand(value: unknown): "feishu" | "lark" | undefined {
  return value === "feishu" || value === "lark" ? value : undefined;
}

function parseJsonObject(value: string, code: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value) as unknown);
  } catch {
    throw new Error(`${code}: lark-cli returned malformed JSON.`);
  }
}

function unwrapData(value: Record<string, unknown>): Record<string, unknown> {
  const data = record(value.data);
  return Object.keys(data).length > 0 ? data : value;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || hasControlCharacter(normalized)) return undefined;
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function boundedNumber(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function secureUrl(value: unknown): string | undefined {
  const candidate = boundedString(value, 2_048);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTokenStatus(value: unknown): LarkTokenStatus | undefined {
  if (value === "valid" || value === "expired" || value === "invalid") return value;
  if (value === "needs_refresh" || value === "needs-refresh") return "needs-refresh";
  return typeof value === "string" && value.length > 0 ? "unknown" : undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
