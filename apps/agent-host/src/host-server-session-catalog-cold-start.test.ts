import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type CommandResults,
  type ProtocolPort,
  type RendererHello,
  type ResponseEnvelope,
  type WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Set<(event: unknown) => void>();
  postMessage(message: unknown): void { this.sent.push(message); }
  close(): void {}
  addEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    if (type === "message") this.listeners.add(listener);
  }
  removeEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    if (type === "message") this.listeners.delete(listener);
  }
  emit(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

describe("AgentHostServer Session Catalog cold start", () => {
  it("reconciles a physical Session created between Agent Host epochs", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-host-session-catalog-cold-")));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "fixture");
    const catalogDirectory = join(root, "catalog");
    const sessionPath = join(sessionDirectory, "created-between-hosts.jsonl");
    await Promise.all([mkdir(cwd), mkdir(sessionDirectory, { recursive: true }), mkdir(catalogDirectory)]);
    const previous = captureEnvironment();
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI67_SESSION_CATALOG_DIR = catalogDirectory;
    process.env.PI67_STORAGE_ROOT = root;
    const context: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-cold" };
    const runtimeLoader = vi.fn(async () => { throw new Error("Catalog query loaded a Task Runtime."); });
    let firstServer: AgentHostServer | undefined;
    let secondServer: AgentHostServer | undefined;
    try {
      firstServer = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
      const firstPort = await attachAndRegister(firstServer, context, cwd, 11);
      expect(await queryCatalog(firstPort, context, 11, true)).toMatchObject({ items: [], rebuilding: true });
      await waitForReconcile(firstPort);
      expect(await queryCatalog(firstPort, context, 11)).toMatchObject({ items: [], state: "ready" });
      await firstServer.shutdown();
      firstServer = undefined;
      await writeFile(sessionPath, sessionJsonl(cwd), "utf8");

      secondServer = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
      const secondPort = await attachAndRegister(secondServer, context, cwd, 12);
      expect(await queryCatalog(secondPort, context, 12)).toMatchObject({ state: "rebuilding", rebuilding: true });
      await waitForReconcile(secondPort);
      expect(await queryCatalog(secondPort, context, 12)).toMatchObject({
        items: [expect.objectContaining({ path: sessionPath })],
        total: 1,
        state: "ready",
        rebuilding: false
      });
      expect(runtimeLoader).not.toHaveBeenCalled();
    } finally {
      await firstServer?.shutdown();
      await secondServer?.shutdown();
      restoreEnvironment(previous);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function attachAndRegister(
  server: AgentHostServer,
  context: WorkspaceProtocolContext,
  cwd: string,
  hostEpoch: number
): Promise<FakePort> {
  const port = new FakePort();
  server.attachPort(port, { appInstanceId: "app", hostInstanceId: `host-${hostEpoch}`, hostEpoch });
  port.emit({
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: `renderer-${hostEpoch}`,
    appInstanceId: "app",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  const registration = commandEnvelopeForContext("workspace.register", {
    cwd,
    trust: "trusted",
    approvalMode: "guided"
  }, context, hostEpoch, `register-${hostEpoch}`);
  port.emit(registration);
  expect(await responseFor(port, registration.requestId)).toMatchObject({ ok: true });
  return port;
}

async function queryCatalog(
  port: FakePort,
  context: WorkspaceProtocolContext,
  hostEpoch: number,
  refresh = false
): Promise<CommandResults["session.catalog.query"]> {
  const request = commandEnvelopeForContext("session.catalog.query", {
    scope: "workspace",
    limit: 50,
    ...(refresh ? { refresh: true } : {})
  }, context, hostEpoch);
  port.emit(request);
  const response = await responseFor(port, request.requestId);
  if (!response.ok || response.type !== "session.catalog.query") throw new Error("Catalog query failed.");
  return response.result as CommandResults["session.catalog.query"];
}

async function responseFor(port: FakePort, requestId: string): Promise<ResponseEnvelope> {
  let response: ResponseEnvelope | undefined;
  await vi.waitFor(() => {
    response = port.sent.find((value): value is ResponseEnvelope => (
      isResponseEnvelope(value) && value.requestId === requestId
    ));
    expect(response).toBeDefined();
  });
  return response!;
}

async function waitForReconcile(port: FakePort): Promise<void> {
  await vi.waitFor(() => expect(port.sent.some((value) => (
    isEventEnvelope(value)
    && value.type === "session.catalog.changed"
    && "reason" in value.payload
    && value.payload.reason === "reconciled"
  ))).toBe(true));
}

function sessionJsonl(cwd: string): string {
  return [
    { type: "session", version: 3, id: "cold-session", timestamp: "2026-08-04T00:00:00.000Z", cwd },
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-08-04T00:00:01.000Z",
      message: { role: "user", content: "Cold host Catalog Session", timestamp: 1 }
    }
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function captureEnvironment() {
  return {
    agentDir: process.env.PI_CODING_AGENT_DIR,
    catalogDirectory: process.env.PI67_SESSION_CATALOG_DIR,
    storageRoot: process.env.PI67_STORAGE_ROOT
  };
}

function restoreEnvironment(previous: ReturnType<typeof captureEnvironment>): void {
  setEnvironment("PI_CODING_AGENT_DIR", previous.agentDir);
  setEnvironment("PI67_SESSION_CATALOG_DIR", previous.catalogDirectory);
  setEnvironment("PI67_STORAGE_ROOT", previous.storageRoot);
}

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
