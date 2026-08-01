import { describe, expect, it, vi } from "vitest";
import type { ProtocolContext, RendererHello } from "./envelope.js";
import {
  EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS,
  EXTENSION_PACKAGE_WORKER_TIMEOUT_MS
} from "./extension-package-operation.js";
import {
  AgentPortClient,
  CONTROL_MUTATION_ACK_TIMEOUT_MS
} from "./port-client.js";
import { FakePort, hostWelcome } from "./port-client-test-fixtures.js";

describe("AgentPortClient Extension package timeouts", () => {
  it("keeps update checks pending beyond the isolated worker deadline", async () => {
    vi.useFakeTimers();
    try {
      const port = new FakePort();
      const client = new AgentPortClient(port);
      const hello = port.sent[0] as RendererHello;
      port.emit("message", hostWelcome(hello, 4));
      const context: ProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };

      const pending = client.request("extension.package.checkUpdates", {}, [], { context });
      let failure: unknown;
      void pending.catch((error: unknown) => { failure = error; });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(EXTENSION_PACKAGE_WORKER_TIMEOUT_MS);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(
        EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS - EXTENSION_PACKAGE_WORKER_TIMEOUT_MS
      );
      expect(failure).toMatchObject({ code: "REQUEST_TIMEOUT" });
      expect(client.isClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives worker-backed mutations the same long response window", async () => {
    vi.useFakeTimers();
    try {
      const port = new FakePort();
      const client = new AgentPortClient(port);
      const hello = port.sent[0] as RendererHello;
      port.emit("message", hostWelcome(hello, 4));
      const context: ProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };

      const pending = client.request(
        "extension.package.install",
        { source: "npm:pi-example", scope: "global" },
        [],
        { context, idempotencyKey: "install-pi-example" }
      );
      let failure: unknown;
      void pending.catch((error: unknown) => { failure = error; });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(CONTROL_MUTATION_ACK_TIMEOUT_MS);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(
        EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS - CONTROL_MUTATION_ACK_TIMEOUT_MS
      );
      expect(failure).toMatchObject({ code: "REQUEST_TIMEOUT" });
      expect(client.isClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
