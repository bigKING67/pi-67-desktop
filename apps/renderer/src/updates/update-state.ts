const channel = "unsigned-preview" as const;
const maximumArtifactBytes = 2 * 1_024 * 1_024 * 1_024;

interface UpdateMetadata {
  channel: typeof channel;
  currentVersion: string;
  automaticChecks: boolean;
  checkedAt?: string;
}

interface UpdateArtifactMetadata {
  version: string;
  artifactName: string;
  artifactBytes: number;
}

export type UpdateState = UpdateMetadata & (
  | { phase: "checking" | "current" | "idle" }
  | ({ phase: "available" | "installing" } & UpdateArtifactMetadata)
  | ({ phase: "downloading"; transferred: number; percent: number } & UpdateArtifactMetadata)
  | { phase: "disabled" | "error"; detail: string }
);

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
  const metadata = {
    channel,
    currentVersion,
    automaticChecks,
    ...(checkedAt ? { checkedAt } : {})
  };
  if (value.phase === "idle" || value.phase === "checking" || value.phase === "current") {
    return { phase: value.phase, ...metadata };
  }
  if (value.phase === "available" || value.phase === "installing" || value.phase === "downloading") {
    const artifact = parseArtifactMetadata(value);
    if (!artifact) {
      return updateErrorState(
        "更新服务返回了无效的安装包信息；没有执行下载或安装。",
        currentVersion,
        automaticChecks
      );
    }
    if (value.phase === "downloading") {
      if (
        typeof value.transferred !== "number"
        || !Number.isSafeInteger(value.transferred)
        || value.transferred < 0
        || value.transferred > artifact.artifactBytes
        || typeof value.percent !== "number"
        || !Number.isFinite(value.percent)
        || value.percent < 0
        || value.percent > 100
      ) {
        return updateErrorState(
          "更新服务返回了无效的下载进度；已停止显示该进度。",
          currentVersion,
          automaticChecks
        );
      }
      return {
        phase: value.phase,
        ...artifact,
        transferred: value.transferred,
        percent: value.percent,
        ...metadata
      };
    }
    return { phase: value.phase, ...artifact, ...metadata };
  }
  if ((value.phase === "disabled" || value.phase === "error") && isBoundedString(value.detail, 500)) {
    return { phase: value.phase, detail: value.detail, ...metadata };
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

function parseArtifactMetadata(value: Record<string, unknown>): UpdateArtifactMetadata | undefined {
  if (
    !isBoundedString(value.version, 100)
    || !isBoundedString(value.artifactName, 240)
    || typeof value.artifactBytes !== "number"
    || !Number.isSafeInteger(value.artifactBytes)
    || value.artifactBytes < 1
    || value.artifactBytes > maximumArtifactBytes
  ) {
    return undefined;
  }
  const expectedWindows = `Pi-67-Desktop-${value.version}-win-x64-unsigned-preview.exe`;
  const expectedMacos = `Pi-67-Desktop-${value.version}-mac-arm64-unsigned-preview.zip`;
  if (value.artifactName !== expectedWindows && value.artifactName !== expectedMacos) return undefined;
  return {
    version: value.version,
    artifactName: value.artifactName,
    artifactBytes: value.artifactBytes
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
