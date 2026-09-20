import { afterEach, describe, expect, it, vi } from "vitest";
import type { OVClient } from "./client.js";
import { observeDesktopCommit } from "./desktop-commit-outcome.js";

afterEach(() => vi.useRealTimers());
const receipt = { archived: true, task_id: "task", archive_uri: "archive" };
function fixture(task: unknown) {
  const fetchJSON = vi.fn(async () => ({ ok: true, result: task }));
  return { fetchJSON, client: { fetchJSON } as unknown as OVClient };
}
const completed = { task_id: "task", task_type: "session_commit", status: "completed",
  result: { session_id: "lineage", archive_uri: "archive" } };

describe("managed Commit receipt observation", () => {
  it("confirms only the exact task, Session and archive", async () => {
    const f = fixture(completed);
    await expect(observeDesktopCommit(f.client, receipt, "lineage", () => true)).resolves.toBe("completed");
    expect(f.fetchJSON).toHaveBeenCalledWith("/api/v1/tasks/task", undefined, 5_000);
  });
  it.each([
    { ...completed, task_id: "other" }, { ...completed, task_type: "other" },
    { ...completed, result: { ...completed.result, session_id: "other" } },
    { ...completed, result: { ...completed.result, archive_uri: "other" } },
    { ...completed, result: null }, { ...completed, status: "unknown" }, null,
  ])("does not turn mismatched or malformed receipts into success", async task => {
    await expect(observeDesktopCommit(fixture(task).client, receipt, "lineage", () => true)).resolves.toBe("unconfirmed");
  });
  it.each(["failed", "cancelled"])("reports %s without exposing server errors", async status => {
    await expect(observeDesktopCommit(fixture({ ...completed, status, error: "secret" }).client, receipt, "lineage", () => true)).resolves.toBe("failed");
  });
  it("does not claim successful processing with a provider configuration error", async () => {
    await expect(observeDesktopCommit(fixture({ ...completed, result: { ...completed.result, user_config_error: "secret" } }).client,
      receipt, "lineage", () => true)).resolves.toBe("failed");
  });
  it("does not poll a skipped Commit, absent receipt or revoked owner", async () => {
    const f = fixture(completed);
    for (const result of [{ archived: false }, { archived: true }]) {
      expect(await observeDesktopCommit(f.client, result, "lineage", () => true)).toBe("unconfirmed");
    }
    expect(await observeDesktopCommit(f.client, receipt, "lineage", () => false)).toBe("unconfirmed");
    expect(f.fetchJSON).not.toHaveBeenCalled();
  });
  it("rejects a completion arriving after revocation", async () => {
    let current = true;
    const f = fixture(completed);
    f.fetchJSON.mockImplementation(async () => { current = false; return { ok: true, result: completed }; });
    expect(await observeDesktopCommit(f.client, receipt, "lineage", () => current)).toBe("unconfirmed");
  });
  it("bounds observation and does not retry Commit on timeout or read failure", async () => {
    vi.useFakeTimers();
    const f = fixture({ ...completed, status: "running" });
    const pending = observeDesktopCommit(f.client, receipt, "lineage", () => true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe("unconfirmed");
    expect(f.fetchJSON).toHaveBeenCalledTimes(30);
    f.fetchJSON.mockResolvedValue({ ok: false, result: null });
    expect(await observeDesktopCommit(f.client, receipt, "lineage", () => true)).toBe("unconfirmed");
  });
});
