import type { OVClient, OVCommitResult, OVResponse } from "./client.js";

export type ExtractionOutcome = "completed" | "failed" | "unconfirmed";

/** Read only the exact receipt. Never retry Commit or expose task payloads. */
export async function observeDesktopCommit(
  client: OVClient, result: OVCommitResult, lineage: string,
  isCurrent: () => boolean,
): Promise<ExtractionOutcome> {
  if (!result.archived || !result.task_id || !result.archive_uri) return "unconfirmed";
  const deadline = Date.now() + 30_000;
  while (isCurrent() && Date.now() < deadline) {
    const response: OVResponse<unknown> = await client.fetchJSON<unknown>(
      `/api/v1/tasks/${encodeURIComponent(result.task_id)}`, undefined,
      Math.min(5_000, deadline - Date.now()),
    );
    if (!isCurrent() || !response.ok || !isRecord(response.result)) return "unconfirmed";
    const task: Record<string, unknown> = response.result;
    if (task.task_id !== result.task_id || task.task_type !== "session_commit") return "unconfirmed";
    if (task.status === "completed") {
      if (isRecord(task.result) && task.result.user_config_error) return "failed";
      return isRecord(task.result) && task.result.session_id === lineage
        && task.result.archive_uri === result.archive_uri ? "completed" : "unconfirmed";
    }
    if (task.status === "failed" || task.status === "cancelled") return "failed";
    if (!["pending", "running", "cancelling"].includes(String(task.status))) return "unconfirmed";
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(1_000, Math.max(0, deadline - Date.now()))));
  }
  return "unconfirmed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
