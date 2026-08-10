export type LarkCliStatus = "ready" | "missing";

export type LarkAuthPhase = "connected" | "disconnected" | "authorizing" | "error";

export type LarkTokenStatus = "valid" | "needs-refresh" | "expired" | "invalid" | "unknown";

export type LarkAppStatus = "ready" | "missing" | "unknown";

export type LarkAppBrand = "feishu" | "lark";

export const MAX_LARK_APP_ID_CHARS = 256;
export const MAX_LARK_APP_SECRET_CHARS = 512;

export interface LarkAppConfigurationInput {
  appId: string;
  appSecret: string;
  brand: LarkAppBrand;
}

export interface LarkAuthSnapshot {
  cliStatus: LarkCliStatus;
  phase: LarkAuthPhase;
  verified: boolean;
  checkedAt: number;
  appStatus: LarkAppStatus;
  appId?: string;
  appBrand?: LarkAppBrand;
  appName?: string;
  userName?: string;
  tokenStatus?: LarkTokenStatus;
  tokenExpiresAt?: number;
  detail?: string;
}

export interface LarkAuthLoginStartResult {
  status: LarkAuthSnapshot;
  verificationUrl: string;
  userCode?: string;
  authorizationExpiresAt: number;
}
