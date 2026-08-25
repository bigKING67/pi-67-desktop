import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
        protocolVersion: PROTOCOL_VERSION,
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

  it("renames, pins, snoozes, archives, restores, and replays cold conversation mutations without loading a Task Runtime", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-host-conversation-organization-")));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "fixture");
    const catalogDirectory = join(root, "catalog");
    const sessionPath = join(sessionDirectory, "conversation.jsonl");
    const secondSessionPath = join(sessionDirectory, "conversation-two.jsonl");
    const thirdSessionPath = join(sessionDirectory, "conversation-three.jsonl");
    await Promise.all([
      mkdir(cwd),
      mkdir(sessionDirectory, { recursive: true }),
      mkdir(catalogDirectory)
    ]);
    await Promise.all([
      writeFile(sessionPath, sessionJsonl(cwd), "utf8"),
      writeFile(secondSessionPath, sessionJsonl(cwd), "utf8"),
      writeFile(thirdSessionPath, sessionJsonl(cwd), "utf8")
    ]);
    const previous = {
      agentDir: process.env.PI_CODING_AGENT_DIR,
      catalogDirectory: process.env.PI67_SESSION_CATALOG_DIR,
      storageRoot: process.env.PI67_STORAGE_ROOT
    };
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI67_SESSION_CATALOG_DIR = catalogDirectory;
    process.env.PI67_STORAGE_ROOT = root;

    const runtimeLoader = vi.fn(async () => { throw new Error("Conversation organization must not load a Task Runtime."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    try {
      const port = new FakePort();
      const context: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-organize" };
      server.attachPort(port, { appInstanceId: "app", hostInstanceId: "host", hostEpoch: 9 });
      port.emit({
        protocolVersion: PROTOCOL_VERSION,
        protocolRevision: PROTOCOL_REVISION,
        kind: "hello",
        rendererInstanceId: "renderer-organize",
        appInstanceId: "app",
        maxEnvelopeBytes: 2 * 1024 * 1024
      } satisfies RendererHello);
      await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

      const registration = commandEnvelopeForContext("workspace.register", {
        cwd,
        trust: "trusted",
        approvalMode: "guided"
      }, context, 9, "register-workspace-organize");
      port.emit(registration);
      expect(await responseFor(port, registration.requestId)).toMatchObject({
        ok: true,
        result: { registered: true }
      });

      const refresh = commandEnvelopeForContext("session.catalog.query", {
        scope: "workspace",
        limit: 50,
        refresh: true
      }, context, 9);
      port.emit(refresh);
      expect(await responseFor(port, refresh.requestId)).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(port.sent.some((value) => (
        isEventEnvelope(value)
        && value.type === "session.catalog.changed"
        && "reason" in value.payload
        && value.payload.reason === "reconciled"
      ))).toBe(true));

      const rename = commandEnvelopeForContext("session.nameByPath", {
        path: sessionPath,
        mutation: { action: "set", name: "显式固定标题" }
      }, context, 9, "rename-cold-conversation");
      port.emit(rename);
      const renamed = await responseFor(port, rename.requestId);
      if (!renamed.ok) throw new Error(`${renamed.error.code}: ${renamed.error.message}`);
      expect(renamed).toMatchObject({ ok: true, result: { revision: expect.any(Number) } });

      const renameReplay = commandEnvelopeForContext("session.nameByPath", {
        path: sessionPath,
        mutation: { action: "set", name: "显式固定标题" }
      }, context, 9, "rename-cold-conversation");
      port.emit(renameReplay);
      expect(await responseFor(port, renameReplay.requestId)).toMatchObject({
        ok: true,
        result: renamed.ok ? renamed.result : undefined
      });
      expect((await readFile(sessionPath, "utf8")).match(/"type":"session_info"/gu)).toHaveLength(1);

      const pinned = commandEnvelopeForContext("conversation.pin", {
        path: sessionPath,
        pinned: true
      }, context, 9, "pin-cold-conversation");
      port.emit(pinned);
      expect(await responseFor(port, pinned.requestId)).toMatchObject({ ok: true });
      const activeAfterPin = await queryCatalog(port, context, { view: "active" });
      expect(activeAfterPin.items).toEqual([
        expect.objectContaining({
          path: sessionPath,
          name: "显式固定标题",
          nameSource: "explicit",
          pinnedAt: expect.any(Number)
        }),
        expect.any(Object),
        expect.any(Object)
      ]);

      for (const [index, path] of [secondSessionPath, thirdSessionPath].entries()) {
        const pin = commandEnvelopeForContext("conversation.pin", {
          path,
          pinned: true
        }, context, 9, `pin-cold-conversation-${index + 2}`);
        port.emit(pin);
        expect(await responseFor(port, pin.requestId)).toMatchObject({ ok: true });
      }
      const reorder = commandEnvelopeForContext("conversation.reorderPinned", {
        paths: [sessionPath, thirdSessionPath, secondSessionPath]
      }, context, 9, "reorder-cold-conversations");
      port.emit(reorder);
      expect(await responseFor(port, reorder.requestId)).toMatchObject({ ok: true });
      expect((await queryCatalog(port, context, { view: "active" })).items
        .filter((item) => item.pinnedAt !== undefined)
        .map((item) => item.path)).toEqual([sessionPath, thirdSessionPath, secondSessionPath]);

      const archived = commandEnvelopeForContext("conversation.archive", {
        path: sessionPath,
        archived: true
      }, context, 9, "archive-cold-conversation");
      port.emit(archived);
      expect(await responseFor(port, archived.requestId)).toMatchObject({ ok: true });
      expect((await queryCatalog(port, context, { view: "active" })).items.map((item) => item.path))
        .toEqual([thirdSessionPath, secondSessionPath]);
      const archivedItems = (await queryCatalog(port, context, { view: "archived" })).items;
      expect(archivedItems).toEqual([
        expect.objectContaining({
          path: sessionPath,
          archivedAt: expect.any(Number)
        })
      ]);
      expect(archivedItems[0]).not.toHaveProperty("pinnedAt");

      const organizationRaw = await readFile(
        join(root, "conversation-organization", "organization-v3.json"),
        "utf8"
      );
      expect(organizationRaw).not.toContain(sessionPath);
      expect(organizationRaw).not.toContain("修复冷启动对话标题");

      const restored = commandEnvelopeForContext("conversation.archive", {
        path: sessionPath,
        archived: false
      }, context, 9, "restore-cold-conversation");
      port.emit(restored);
      expect(await responseFor(port, restored.requestId)).toMatchObject({ ok: true });

      const snoozedUntil = Date.now() + 60 * 60 * 1_000;
      const snoozed = commandEnvelopeForContext("conversation.snooze", {
        path: sessionPath,
        snoozedUntil
      }, context, 9, "snooze-cold-conversation");
      port.emit(snoozed);
      expect(await responseFor(port, snoozed.requestId)).toMatchObject({ ok: true });
      expect((await queryCatalog(port, context, { view: "active" })).items.find((item) => item.path === sessionPath))
        .toEqual(expect.objectContaining({ snoozedUntil }));

      const wake = commandEnvelopeForContext("conversation.snooze", {
        path: sessionPath
      }, context, 9, "wake-cold-conversation");
      port.emit(wake);
      expect(await responseFor(port, wake.requestId)).toMatchObject({ ok: true });
      expect((await queryCatalog(port, context, { view: "active" })).items.find((item) => item.path === sessionPath))
        .not.toHaveProperty("snoozedUntil");

      const clearName = commandEnvelopeForContext("session.nameByPath", {
        path: sessionPath,
        mutation: { action: "clear" }
      }, context, 9, "restore-automatic-title");
      port.emit(clearName);
      expect(await responseFor(port, clearName.requestId)).toMatchObject({ ok: true });
      const automaticTitleEventsBefore = port.sent.filter(isAutomaticTitleCatalogEvent).length;
      const pendingAutomatic = await queryCatalog(port, context, { view: "active" });
      const pendingItem = pendingAutomatic.items.find((item) => item.path === sessionPath);
      expect(pendingItem).toEqual(expect.objectContaining({ path: sessionPath }));
      if (pendingItem?.nameSource === "fallback") {
        await vi.waitFor(() => expect(port.sent.filter(isAutomaticTitleCatalogEvent).length)
          .toBeGreaterThan(automaticTitleEventsBefore));
      }
      const automatic = pendingItem?.nameSource === "seed"
        ? pendingAutomatic
        : await queryCatalog(port, context, { view: "active" });
      const restoredItem = automatic.items.find((item) => item.path === sessionPath);
      expect(restoredItem).toEqual(expect.objectContaining({
        path: sessionPath,
        name: "修复冷启动对话标题",
        nameSource: "seed"
      }));
      expect(restoredItem).not.toHaveProperty("pinnedAt");
      expect(restoredItem).not.toHaveProperty("archivedAt");

      const contentSearch = commandEnvelopeForContext("session.catalog.contentSearch", {
        query: "冷启动"
      }, context, 9);
      port.emit(contentSearch);
      const contentResponse = await responseFor(port, contentSearch.requestId);
      expect(contentResponse).toMatchObject({
        ok: true,
        type: "session.catalog.contentSearch",
        result: {
          workspaceId: context.workspaceId,
          items: [
            expect.objectContaining({ role: "user", snippet: expect.stringContaining("冷启动") }),
            expect.objectContaining({ role: "user", snippet: expect.stringContaining("冷启动") }),
            expect.objectContaining({ role: "user", snippet: expect.stringContaining("冷启动") })
          ],
          sessionsVisited: 3,
          entriesVisited: 6,
          incomplete: false
        }
      });
      expect(runtimeLoader).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
      restoreEnvironment("PI_CODING_AGENT_DIR", previous.agentDir);
      restoreEnvironment("PI67_SESSION_CATALOG_DIR", previous.catalogDirectory);
      restoreEnvironment("PI67_STORAGE_ROOT", previous.storageRoot);
      await rm(root, { recursive: true, force: true });
    }
  });
});

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

async function queryCatalog(
  port: FakePort,
  context: WorkspaceProtocolContext,
  options: { view: "active" | "archived" }
): Promise<CommandResults["session.catalog.query"]> {
  const request = commandEnvelopeForContext("session.catalog.query", {
    scope: "workspace",
    view: options.view,
    limit: 50
  }, context, 9);
  port.emit(request);
  const response = await responseFor(port, request.requestId);
  if (!response.ok || response.type !== "session.catalog.query") {
    throw new Error(`Session Catalog query failed: ${response.type}`);
  }
  return response.result as CommandResults["session.catalog.query"];
}

function sessionJsonl(cwd: string): string {
  return [
    {
      type: "session",
      version: 3,
      id: "conversation-session",
      timestamp: "2026-08-04T00:00:00.000Z",
      cwd
    },
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-08-04T00:00:01.000Z",
      message: { role: "user", content: "修复冷启动对话标题", timestamp: 1 }
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-08-04T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "已完成" }],
        api: "openai-responses",
        provider: "fixture",
        model: "fixture",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "stop",
        timestamp: 2
      }
    }
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function isAutomaticTitleCatalogEvent(value: unknown): boolean {
  return isEventEnvelope(value)
    && value.type === "session.catalog.changed"
    && typeof value.payload === "object"
    && value.payload !== null
    && "reason" in value.payload
    && value.payload.reason === "automatic-title";
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
