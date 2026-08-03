const channel = "unsigned-preview" as const;
const releasePageBaseUrl = "https://github.com/bigKING67/pi-67-desktop/releases/tag/";

export type UpdateState =
  | {
      phase: "idle" | "current";
      channel: typeof channel;
      currentVersion: string;
      automaticChecks: boolean;
      checkedAt?: string;
    }
  | {
      phase: "available";
      channel: typeof channel;
      currentVersion: string;
      version: string;
      releaseUrl: string;
      automaticChecks: boolean;
      publishedAt?: string;
      checkedAt?: string;
    }
  | {
      phase: "disabled" | "error";
      channel: typeof channel;
      currentVersion: string;
      detail: string;
      automaticChecks: boolean;
      checkedAt?: string;
    };

export const idleUpdateState: UpdateState = {
  phase: "idle",
  channel,
  currentVersion: "unknown",
  automaticChecks: false
};

export function parseUpdateState(value: unknown): UpdateState {
  if (
    !isRecord(value)
    || value.channel !== channel
    || !isBoundedString(value.currentVersion, 100)
    || typeof value.automaticChecks !== "boolean"
  ) {
    return updateErrorState("更新服务返回了无法识别的状态；没有执行下载或安装。");
  }
  const currentVersion = value.currentVersion;
  const automaticChecks = value.automaticChecks;
  const checkedAt = parseDate(value.checkedAt);
  const metadata = { automaticChecks, ...(checkedAt ? { checkedAt } : {}) };
  if (value.phase === "idle" || value.phase === "current") {
    return { phase: value.phase, channel, currentVersion, ...metadata };
  }
  if (value.phase === "available" && isBoundedString(value.version, 100)) {
    const releaseUrl = `${releasePageBaseUrl}v${value.version}`;
    if (value.releaseUrl !== releaseUrl) {
      return updateErrorState("更新服务返回了无效的下载地址；没有打开外部页面。", currentVersion, automaticChecks);
    }
    const publishedAt = parseDate(value.publishedAt);
    return {
      phase: "available",
      channel,
      currentVersion,
      version: value.version,
      releaseUrl,
      ...metadata,
      ...(publishedAt ? { publishedAt } : {})
    };
  }
  if ((value.phase === "disabled" || value.phase === "error") && isBoundedString(value.detail, 500)) {
    return { phase: value.phase, channel, currentVersion, detail: value.detail, ...metadata };
  }
  return updateErrorState(
    "更新服务返回了无法识别的状态；没有执行下载或安装。",
    currentVersion,
    automaticChecks
  );
}

export function updateErrorState(
  detail: string,
  currentVersion = "unknown",
  automaticChecks = false
): UpdateState {
  return {
    phase: "error",
    channel,
    currentVersion,
    detail: detail.slice(0, 500),
    automaticChecks
  };
}

function parseDate(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
