import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupRouterFixtures, createRouter, workspaceContext } from "./context-memory-command-router.test-support.js";

afterEach(cleanupRouterFixtures);
describe("Host manual private Commit admission", () => {
  it.each([
    [{ status: "skipped", archived: false, reason: "all_within_keep_window" }, "retained"],
    [{ status: "skipped", archived: false, reason: "no_messages" }, "empty"],
    [{ status: "accepted", archived: true }, "unconfirmed"],
    [{ status: "accepted", archived: true, extraction: "completed" }, "extracted"],
    [{ status: "accepted", archived: true, extraction: "failed" }, "extraction-failed"],
  ] as const)("projects truthful private outcomes: %s", async (result, outcome) => {
    const f = await createRouter({ enabled: true }, { commitPrivateSession: async () => result });
    await f.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.commit", payload: { submissionId: "commit", sessionId: "session/one" }
    }, "commit");
    await f.router.shutdown();
    expect(f.events).toContainEqual(expect.objectContaining({ type: "context.commitCompleted", payload: expect.objectContaining({ outcome }) }));
  });
  it.each(["read-only", "off"])("never invokes the memory owner in %s mode", async (privacyMode) => {
    const f = await createRouter({ enabled: true, privacyMode });
    await f.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.commit", payload: { submissionId: "commit", sessionId: "session/one" }
    }, "commit");
    await f.router.shutdown();
    expect(f.commitPrivateSession).not.toHaveBeenCalled();
    expect(f.events).toContainEqual(expect.objectContaining({ type: "context.commitFailed" }));
    expect(f.events.some(event => event.type === "context.commitCompleted")).toBe(false);
  });
  it.each(["missing", "rejected"])("does not fall back to HTTP when the owner is %s", async (reason) => {
    const fetch = vi.fn(() => { throw new Error("unexpected HTTP"); });
    vi.stubGlobal("fetch", fetch);
    const f = await createRouter({ enabled: true }, {
      commitPrivateSession: reason === "missing" ? null : async () => { throw new Error("scope blocked"); }
    });
    await f.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.commit", payload: { submissionId: "commit", sessionId: "session/one" }
    }, "commit");
    await f.router.shutdown();
    expect(fetch).not.toHaveBeenCalled();
    expect(f.events).toContainEqual(expect.objectContaining({ type: "context.commitFailed" }));
    expect(f.events.some(event => event.type === "context.commitCompleted")).toBe(false);
  });
});
