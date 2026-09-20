import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { PiSdkRuntime, createRuntimeCredentialOverrideStore } from "@pi67/pi-runtime";
import { TaskRuntimeRegistry } from "../task-runtime-registry.js";
import { LocalMemoryBrokerClient, managedLocalMemoryOptions } from "./local-memory-broker-client.js";

it.each([true, false])("connects a real Pi Task through the Host broker without fallback (available=%s)", async (available) => {
  const root = await mkdtemp(join(tmpdir(), "pi67-local-memory-task-"));
  const agentDir = join(root, "agent"), cwd = join(root, "workspace");
  await Promise.all([mkdir(agentDir), mkdir(cwd)]);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir); vi.stubEnv("PI67_DESKTOP", "0");
  const extensionRoot = fileURLToPath(new URL("../../../../packages/openviking-pi-extension", import.meta.url));
  const profile = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
  const connection = { endpoint: "http://127.0.0.1:32101", apiKey: "synthetic-private-key",
    localProfileId: profile, account: `private-${profile}`, user: "desktop" };
  const parent = { postMessage: vi.fn((request: { requestId: string }) => {
    queueMicrotask(() => broker.handleResult(available
      ? { type: "local-memory-connect-result", requestId: request.requestId, ok: true, connection }
      : { type: "local-memory-connect-result", requestId: request.requestId, ok: false, errorCode: "NOT_CONFIGURED" }));
  }) };
  const broker = new LocalMemoryBrokerClient(parent);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ status: "ok", result: [] }),
    { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const registry = new TaskRuntimeRegistry(async (options) => new PiSdkRuntime(options),
    createRuntimeCredentialOverrideStore(), managedLocalMemoryOptions(true, broker));
  try {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [extensionRoot] }));
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({ enabled: true, privacyMode: "read-only",
      logLevel: "silent", takeover: { enabled: false }, endpoint: "http://127.0.0.1:1933" }));
    const runtime = await registry.load({ scope: "task", workspaceId: "fixture-workspace", taskId: "fixture-task", taskGeneration: 1 });
    const session = await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
    expect(session.sessionId).toEqual(expect.any(String));
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "local-memory-connect", requestId: expect.any(String) });
    if (available) expect(fetch).toHaveBeenCalled();
    else expect(fetch).not.toHaveBeenCalled();
    for (const call of fetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(call[0].startsWith(connection.endpoint + "/")).toBe(true);
      expect(new Headers(call[1].headers).get("Authorization")).toBe("Bearer synthetic-private-key");
      expect(call[1].redirect).toBe("error");
    }
  } finally {
    try { await registry.disposeAll(); } finally {
      broker.shutdown(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  }
}, 20_000);
