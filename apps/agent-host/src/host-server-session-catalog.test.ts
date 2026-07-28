import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_REVISION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type ProtocolPort,
  type RendererHello,
  type WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: unknown): void { this.sent.push(message); }
  close(): void {}
  addEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

describe("AgentHostServer Session Catalog", () => {
  it("returns bounded Workspace pages and publishes metadata-only invalidation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-host-session-catalog-"));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const catalogDirectory = join(root, "catalog");
    await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(catalogDirectory)]);
    const previous = {
      agentDir: process.env.PI_CODING_AGENT_DIR,
      catalogDirectory: process.env.PI67_SESSION_CATALOG_DIR,
      storageRoot: process.env.PI67_STORAGE_ROOT
    };
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI67_SESSION_CATALOG_DIR = catalogDirectory;
    process.env.PI67_STORAGE_ROOT = root;

    const runtimeLoader = vi.fn(async () => { throw new Error("Catalog queries must not load a Task Runtime."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    try {
      const port = new FakePort();
      const context: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-catalog" };
      server.attachPort(port, { appInstanceId: "app", hostInstanceId: "host", hostEpoch: 9 });
      port.emit({
        protocolVersion: 3,
        protocolRevision: PROTOCOL_REVISION,
        kind: "hello",
        rendererInstanceId: "renderer",
        appInstanceId: "app",
        maxEnvelopeBytes: 2 * 1024 * 1024
      } satisfies RendererHello);
      await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

      const registration = commandEnvelopeForContext("workspace.register", {
        cwd,
        trust: "trusted",
        approvalMode: "guided"
      }, context, 9, "register-workspace-catalog");
      port.emit(registration);
      await vi.waitFor(() => {
        expect(port.sent.find((value) => (
          isResponseEnvelope(value) && value.requestId === registration.requestId
        ))).toMatchObject({ ok: true, result: { registered: true }, context });
      });

      const query = commandEnvelopeForContext("session.catalog.query", {
        scope: "workspace",
        limit: 50,
        refresh: true
      }, context, 9);
      port.emit(query);
      await vi.waitFor(() => {
        expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === query.requestId))
          .toMatchObject({
            ok: true,
            type: "session.catalog.query",
            context,
            result: { items: [], total: 0, hasMore: false }
          });
      });
      expect(runtimeLoader).not.toHaveBeenCalled();

      await vi.waitFor(() => {
        const changed = port.sent.find((value) => (
          isEventEnvelope(value) && value.type === "session.catalog.changed"
        ));
        expect(changed).toMatchObject({ context, payload: { reason: "reconciled" } });
        expect(JSON.stringify(changed)).not.toMatch(/"(?:items|sessions)"/u);
      });
    } finally {
      await server.shutdown();
      restoreEnvironment("PI_CODING_AGENT_DIR", previous.agentDir);
      restoreEnvironment("PI67_SESSION_CATALOG_DIR", previous.catalogDirectory);
      restoreEnvironment("PI67_STORAGE_ROOT", previous.storageRoot);
    }
  });
});

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
