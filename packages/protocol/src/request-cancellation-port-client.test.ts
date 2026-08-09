import { describe, expect, it, vi } from "vitest";
import { responseEnvelope, type ProtocolContext, type RendererHello } from "./envelope.js";
import { AgentPortClient } from "./port-client.js";
import { FakePort, hostWelcome } from "./port-client-test-fixtures.js";

describe("AgentPortClient request cancellation", () => {
  it("cancels one pending request without closing the shared Port", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));
    const controller = new AbortController();
    const context: ProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };

    const pending = client.request("workspace.usage.report", { window: "30d" }, [], {
      context,
      signal: controller.signal
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(2));
    const request = port.sent[1] as { requestId: string };
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(port.sent[2]).toMatchObject({
      kind: "request-cancel",
      requestId: request.requestId,
      hostEpoch: 4
    });
    expect(client.isClosed).toBe(false);
    expect(port.closed).toBe(false);

    port.emit("message", responseEnvelope(request.requestId, 4, context, {
      ok: true,
      type: "workspace.usage.report",
      result: emptyUsageReport()
    }));
    expect(client.isClosed).toBe(false);
  });
});

function emptyUsageReport() {
  return {
    workspaceId: "workspace-1",
    generatedAt: 1,
    window: "30d" as const,
    buckets: [],
    models: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    coverage: {
      discoveredSessions: 0,
      scannedSessions: 0,
      skippedSessions: 0,
      unavailableSessions: 0,
      invalidSessions: 0,
      futureVersionSessions: 0,
      undatedUsageEntries: 0,
      complete: true
    }
  };
}
