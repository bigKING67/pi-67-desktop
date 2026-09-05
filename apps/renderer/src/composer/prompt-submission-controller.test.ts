import { responseEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { AgentConnectionController, agentConnectionController } from "../connection/AgentConnectionController.js";
import { agentConnectionRequestContext } from "../connection/agent-connection-request-context.js";
import { HostConnection, FakeHandoffTarget } from "../connection/AgentConnectionController.test-fixture.js";
import { submitRendererPrompt } from "./prompt-submission-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture, sessionSnapshotFixture } from "../session/session-projection-test-support.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";

const responseForB = {
  kind: "accepted" as const, operationId: "op-b", cancellable: true, hostEpoch: 9,
  sessionId: "session-b", sessionFileIdentity: "file-b", sessionGeneration: 2
};

describe("selected task differs from active projection", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a", displayName: "A", identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted", trustProvenance: "native-picker", availability: "available"
    });
    rendererWorkbenchStore.getState().openTask({
      id: "task-b", workspaceId: "workspace-a", conversation: { kind: "session", workspaceId: "workspace-a", sessionFileIdentity: "file-b", sessionPath: "/sessions/b.jsonl" },
      sessionId: "session-b", sessionFileIdentity: "file-b", sessionGeneration: 2, taskGeneration: 1,
      lifecycle: "idle", runtime: { phase: "ready", detail: "ready", recoverable: true }, title: "B", hasDraft: true, attachmentCount: 0, toolMode: "auto"
    });
    useTaskDraftStore.getState().setText("task-b", "draft for B");
    useAppStore.setState({ connected: true, hostEpoch: 9, workspace: "/work/a", trust: "trusted", sessionTransitionPending: true });
    installSessionProjectionFixture({ connected: true, hostEpoch: 9 }, sessionSnapshotFixture({ sessionId: "session-a", sessionFileIdentity: "file-a" }), 1);
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends B context through a port and receives B's acknowledgement", async () => {
    const target = new FakeHandoffTarget();
    const controller = new AgentConnectionController(target);
    const host = new HostConnection(9);
    try {
      host.handoff(target);
      await controller.waitForConnection();
      const pending = controller.request("prompt.submit", { submissionId: "submission-b", text: "draft for B", delivery: "new-turn" });
      const request = await host.nextRequest("prompt.submit");
      expect(request.context).toEqual({
        scope: "task", workspaceId: "workspace-a", taskId: "task-b", taskGeneration: 1,
        sessionId: "session-b", sessionFileIdentity: "file-b", sessionGeneration: 2
      });
      host.send(responseEnvelope(request.requestId, 9, request.context, {
        ok: true, type: "prompt.submit", result: responseForB
      }));
      await expect(pending).resolves.toEqual(responseForB);
    } finally {
      controller.dispose();
      host.dispose();
    }
  });

  it("rejects submission before dispatch while selected B is awaiting its projection", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({ appInstanceId: "app", hostInstanceId: "host", hostEpoch: 9, sdkVersion: "0.84.3", eventSequence: 0 });
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type, payload) => {
      expect(agentConnectionRequestContext(type, payload)).toMatchObject({
        scope: "task", taskId: "task-b", sessionId: "session-b", sessionFileIdentity: "file-b", sessionGeneration: 2
      });
      return responseForB as never;
    });
    await expect(submitRendererPrompt("draft for B", "send", "submission-b")).resolves.toEqual({
      accepted: false, error: "Pi 会话身份尚未就绪，消息未发送"
    });
    expect(request).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-b"]?.lifecycle).toBe("idle");
    expect(useTaskDraftStore.getState().drafts["task-b"]?.text).toBe("draft for B");
    useAppStore.setState({ sessionTransitionPending: false });
    installSessionProjectionFixture({ connected: true, hostEpoch: 9 }, sessionSnapshotFixture({
      sessionId: "session-b", sessionFileIdentity: "file-b"
    }), 2);
    await expect(submitRendererPrompt("draft for B", "send", "submission-b"))
      .resolves.toMatchObject({ accepted: true, operationId: "op-b" });
    expect(request).toHaveBeenCalledOnce();
    expect(rendererWorkbenchStore.getState().tasks["task-b"]?.lifecycle).toBe("accepted");
  });

});
