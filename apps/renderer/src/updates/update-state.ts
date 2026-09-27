import { parseDesktopUpdateState, UPDATE_CHANNEL, type DesktopUpdateState, type DesktopUpdateStateIssue } from "@pi67/protocol";

/** The protocol-owned Main -> renderer update state; see packages/protocol/src/desktop-update-state.ts. */
export type UpdateState = DesktopUpdateState;

export const idleUpdateState: UpdateState = {
  phase: "idle",
  channel: UPDATE_CHANNEL,
  currentVersion: "unknown",
  automaticChecks: false
};

const issueMessages: Record<DesktopUpdateStateIssue, string> = {
  metadata: "更新服务返回了无法识别的状态；没有执行下载或安装。",
  artifact: "更新服务返回了无效的安装包信息；没有执行下载或安装。",
  progress: "更新服务返回了无效的下载进度；已停止显示该进度。",
  phase: "更新服务返回了无法识别的状态；没有执行下载或安装。"
};

/** The preload bridge is untrusted input: every value is validated before it reaches the UI. */
export function parseUpdateState(value: unknown): UpdateState {
  const parsed = parseDesktopUpdateState(value);
  if (parsed.ok) return parsed.state;
  if (parsed.issue === "metadata") return updateErrorState(issueMessages.metadata);
  const metadata = value as { currentVersion: string; automaticChecks: boolean };
  return updateErrorState(issueMessages[parsed.issue], metadata.currentVersion, metadata.automaticChecks);
}

export function updateErrorState(
  detail: string,
  currentVersion = "unknown",
  automaticChecks = false
): UpdateState {
  return {
    phase: "error",
    channel: UPDATE_CHANNEL,
    currentVersion,
    detail: detail.slice(0, 500),
    automaticChecks
  };
}
