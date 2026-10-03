import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PiSdkRuntime } from "../../packages/pi-runtime/src/pi-sdk-runtime.ts";
import {
  assertSingleShutdownQuitLifecycle,
  CONTROLLED_PROMPT_TEXT,
  NATIVE_MCP_PROMPT_TEXT,
  isProcessAlive,
  readPositiveProcessId,
  resetControlledShutdownLifecycle,
  waitForProcessExit,
  writeControlledShutdownExtension,
  writeShutdownLifecycleExtension
} from "./controlled-shutdown-fixture.ts";

describe("controlled shutdown fixture", () => {
  const roots = [];
  const children = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid && isProcessAlive(child.pid)) child.kill();
    }
    await Promise.all(roots.splice(0).map((root) => rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50
    })));
  });

  it("records the real native tool result even when a later provider request has only the prompt prefix", async () => {
    // Resolve Pi from its actual dependency owner; the external temporary
    // node_modules junction failed dependency resolution on the Windows runner.
    const root = await mkdtemp(fileURLToPath(new URL(
      "../../packages/pi-runtime/node_modules/.pi67-native-receipt-", import.meta.url
    )));
    roots.push(root);
    const extensionPath = join(root, "fixture.mjs");
    const evidencePath = join(root, "evidence.json");
    await writeControlledShutdownExtension({ extensionPath, nativeMcpEvidencePath: evidencePath,
      childPidPath: join(root, "child.pid"), lifecyclePath: join(root, "lifecycle.txt") });
    const { default: factory } = await import(pathToFileURL(extensionPath).href);
    const handlers = new Map();
    let provider;
    const toolName = "mcp__packaged_native__echo";
    factory({ on: (event, handler) => handlers.set(event, handler), registerCommand: () => {},
      registerProvider: (_name, registered) => { provider = registered; },
      getAllTools: () => [{ name: toolName, sourceInfo: { source: "inline", path: "<inline:pi67-native-mcp>",
        scope: "temporary", origin: "top-level" } }] });
    const context = { messages: [{ role: "user", content: NATIVE_MCP_PROMPT_TEXT }] };
    const model = { api: "openai-responses", provider: "synthetic", id: "synthetic" };
    provider.streamSimple(model, context, {});
    handlers.get("tool_call")({ toolName });
    handlers.get("tool_result")({ toolName, isError: false,
      content: [{ type: "text", text: "PACKAGED_NATIVE_MCP_OK" }] });
    provider.streamSimple(model, context, {});
    expect(JSON.parse(await readFile(evidencePath, "utf8"))).toMatchObject({
      modelSelected: true, toolCallObserved: true, resultObserved: true, resultSucceeded: true
    });
    handlers.get("tool_result")({ toolName, isError: true, content: [{ type: "text", text: "SYNTHETIC_ERROR" }] });
    expect(JSON.parse(await readFile(evidencePath, "utf8"))).toMatchObject({ resultSucceeded: false });
  });

  it("writes the reusable Extension and observes a controlled child lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-shutdown-"));
    roots.push(root);
    const extensionPath = join(root, "shutdown-fixture.ts");
    const childPidPath = join(root, "child.pid");
    const lifecyclePath = join(root, "lifecycle.txt");

    await writeControlledShutdownExtension({ extensionPath, childPidPath, lifecyclePath });
    const source = await readFile(extensionPath, "utf8");
    expect(source).toContain('pi.registerCommand("hold-open"');
    expect(source).toContain('pi.registerProvider("pi67-controlled"');
    expect(source).toContain('input: ["text", "image"]');
    expect(source).toContain('pi.on("before_agent_start"');
    expect(source).not.toContain('pi.on("session_start"');
    expect(source).toContain('pi.on("session_shutdown"');
    expect(source).toContain('options?.signal?.addEventListener("abort"');
    expect(source).toContain("ELECTRON_RUN_AS_NODE");
    expect(source).toContain('const nativeToolName = "mcp__packaged_native__echo"');
    expect(source).toContain('pi.on("tool_call"');

    const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
    children.push(child);
    if (!child.pid) throw new Error("Controlled test child did not expose a PID.");
    await writeFile(childPidPath, String(child.pid), "utf8");

    await expect(readPositiveProcessId(childPidPath)).resolves.toBe(child.pid);
    expect(isProcessAlive(child.pid)).toBe(true);
    child.kill();
    await expect(waitForProcessExit(child.pid)).resolves.toBeUndefined();
    expect(isProcessAlive(child.pid)).toBe(false);
  });

  it("persists the active controlled prompt as a managed Session that can be restored after shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-shutdown-session-"));
    roots.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const childPidPath = join(root, "child.pid");
    const lifecyclePath = join(root, "lifecycle.txt");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await writeControlledShutdownExtension({
      extensionPath: join(extensionsDirectory, "shutdown-fixture.ts"),
      childPidPath,
      lifecyclePath
    });

    const runtime = new PiSdkRuntime();
    const restoredRuntime = new PiSdkRuntime();
    let childPid;
    try {
      await runtime.initialize({ cwd, agentDir, trust: "trusted" });
      const invocation = runtime.submitPrompt(CONTROLLED_PROMPT_TEXT);
      childPid = await readPositiveProcessId(childPidPath);
      const sessionPath = runtime.getIdentity().sessionPath;
      if (!sessionPath) throw new Error("Controlled prompt did not project a managed Session path.");

      await runtime.dispose();
      await invocation.catch(() => undefined);
      await expect(waitForProcessExit(childPid)).resolves.toBeUndefined();
      await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "Controlled prompt Pi Runtime"))
        .resolves.toBeUndefined();
      await access(sessionPath);

      await restoredRuntime.initialize({
        cwd,
        agentDir,
        sessionPath,
        trust: "trusted"
      });
      expect(restoredRuntime.getIdentity().sessionPath).toBe(await realpath(sessionPath));
    } finally {
      await runtime.dispose();
      await restoredRuntime.dispose();
      if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    }
  }, 15_000);

  it("writes a legacy-compatible shutdown-only Extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-shutdown-lifecycle-"));
    roots.push(root);
    const extensionPath = join(root, "shutdown-fixture.ts");
    const lifecyclePath = join(root, "lifecycle.txt");

    await writeShutdownLifecycleExtension({ extensionPath, lifecyclePath });
    const source = await readFile(extensionPath, "utf8");
    expect(source).toContain('pi.on("session_shutdown"');
    expect(source).not.toContain("pi.registerCommand");
    expect(source).not.toContain("pi.registerProvider");
    expect(source).not.toContain("@earendil-works/pi-ai");
  });

  it("resets probe evidence and accepts only one final shutdown marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-shutdown-lifecycle-"));
    roots.push(root);
    const lifecyclePath = join(root, "lifecycle.txt");

    await writeFile(lifecyclePath, "shutdown:quit\n", "utf8");
    await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "fixture")).resolves.toBeUndefined();

    await writeFile(lifecyclePath, "shutdown:quit\nshutdown:quit\n", "utf8");
    await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "fixture"))
      .rejects.toThrow(
        'expected exactly one session_shutdown(reason=quit) lifecycle entry; observed 2: ["shutdown:quit","shutdown:quit"]'
      );

    await writeFile(lifecyclePath, "shutdown:switch\n", "utf8");
    await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "fixture"))
      .rejects.toThrow(
        'expected exactly one session_shutdown(reason=quit) lifecycle entry; observed 1: ["shutdown:switch"]'
      );

    await resetControlledShutdownLifecycle(lifecyclePath);
    await expect(readFile(lifecyclePath, "utf8")).resolves.toBe("");
  });
});
