import { readFile, stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { callNativeTool, createNativeMcpFixture, isProcessAlive } from "./native-mcp.test-support.js";

describe("Desktop native MCP integration", () => {
  it("keeps collision identities distinct and refreshes schema, additions and withdrawals", async () => {
    const fixture = await createNativeMcpFixture();
    const { session } = fixture;
    try {
      const echo = session.getAllTools().find((tool) => tool.name === "mcp__synthetic__echo");
      expect(echo).toMatchObject({ exposure: "direct", namespace: { name: "mcp__synthetic" }, sourceInfo: {
        source: "inline", path: "<inline:pi67-native-mcp>", scope: "temporary", origin: "top-level"
      } });
      expect(echo?.sourceInfo).not.toHaveProperty("baseDir");
      expect(session.getActiveToolNames()).not.toContain("codemode");
      expect(session.getActiveToolNames()).not.toContain("tool_search");
      const collisions = session.getAllTools().filter((tool) => tool.name.startsWith("mcp__synthetic__a_b"));
      expect(collisions).toHaveLength(2);
      expect(new Set(collisions.map((tool) => tool.name)).size).toBe(2);
      const rawNames = [];
      for (const tool of collisions) {
        const result = await callNativeTool(session, tool.name);
        expect(result?.isError).toBe(false);
        expect(result).toBeDefined();
        rawNames.push((result!.details as { tool: string }).tool);
      }
      expect(rawNames.sort()).toEqual(["a-b", "a_b"]);
      await callNativeTool(session, "mcp__synthetic__refresh");
      await vi.waitFor(() => {
        expect(session.getToolDefinition("mcp__synthetic__added")).toBeDefined();
        expect(session.getActiveToolNames()).not.toContain("mcp__synthetic__withdrawn");
        expect(session.getToolDefinition("mcp__synthetic__echo")?.parameters).toMatchObject({
          properties: { value: { type: "string" } }
        });
      });
      const callsBefore = (await fixture.records()).filter((event) => event.type === "call").length;
      expect(await callNativeTool(session, "mcp__synthetic__withdrawn")).toMatchObject({ isError: true });
      expect((await fixture.records()).filter((event) => event.type === "call")).toHaveLength(callsBefore);
    } finally { await fixture.close(); }
  }, 20_000);

  it("rejects unknown tool identity and invalid schema before stdio even in YOLO", async () => {
    const fixture = await createNativeMcpFixture({ safety: { taskToolMode: "yolo" } });
    try {
      expect(await callNativeTool(fixture.session, "mcp__synthetic__missing")).toMatchObject({ isError: true });
      expect(await callNativeTool(fixture.session, "mcp__synthetic__echo", { unexpected: true }))
        .toMatchObject({ isError: true });
      expect((await fixture.records()).filter((event) => event.type === "call")).toHaveLength(0);
      expect(fixture.requestApproval).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  }, 20_000);

  it.each([
    { taskToolMode: "auto" as const, interactionMode: "execute" as const, calls: 0, approvals: 1 },
    { taskToolMode: "auto" as const, interactionMode: "plan" as const, calls: 0, approvals: 0 },
    { taskToolMode: "yolo" as const, interactionMode: "execute" as const, calls: 0, approvals: 1 }
  ])("enforces deletion confirmation in $taskToolMode/$interactionMode", async (sample) => {
    const fixture = await createNativeMcpFixture({ safety: sample });
    try {
      // Synthetic tool: the real safety hook must stop it before any stdio call.
      const result = await callNativeTool(fixture.session, "mcp__synthetic__delete_file", { path: `${fixture.root}/owned.txt` });
      expect(fixture.requestApproval).toHaveBeenCalledTimes(sample.approvals);
      expect((await fixture.records()).filter((event) => event.type === "call")).toHaveLength(sample.calls);
      expect(result?.isError).toBe(sample.calls === 0);
      if (sample.approvals) {
        expect(fixture.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
          category: "bulk-delete", scope: "single-tool-call"
        }), expect.anything());
      }
      if (sample.interactionMode === "plan") {
        expect(result?.content).toEqual([expect.objectContaining({ text: expect.stringContaining("PLAN_MODE_READ_ONLY") })]);
      }

    } finally { await fixture.close(); }
  }, 20_000);

  it("preserves upstream defaults when host privacy options are omitted", async () => {
    const fixture = await createNativeMcpFixture({ upstreamDefaults: true });
    try {
      const result = await callNativeTool(fixture.session, "mcp__synthetic__large");
      expect(result?.isError).toBe(false);
      const details = result?.details as { fullOutputPath: string };
      expect(details.fullOutputPath).toMatch(/pi-mcp-[a-f0-9]+\.txt$/);
      expect(await readFile(details.fullOutputPath, "utf8"))
        .toBe("SYNTHETIC_OUTPUT_MARKER:" + "x".repeat(30 * 1024));
      if (process.platform !== "win32") expect((await stat(details.fullOutputPath)).mode & 0o777).toBe(0o600);
      await vi.waitFor(async () => {
        expect(await readFile(fixture.logPath, "utf8")).toContain("SYNTHETIC_LOG_MARKER");
      });
      // Existence is observed behavior, not a privacy-compliance pass. The fixture
      // records the exact spill path at tool_execution_end and removes it on close.
    } finally { await fixture.close(); }
  }, 20_000);

  it("keeps large text and binary resources off disk in Desktop", async () => {
    const fixture = await createNativeMcpFixture();
    try {
      const result = await callNativeTool(fixture.session, "mcp__synthetic__large");
      expect(result?.isError).toBe(false);
      expect(result?.details).not.toHaveProperty("fullOutputPath");
      expect(result?.content).toEqual([expect.objectContaining({ text: expect.stringContaining("output persistence is disabled") })]);
      const binary = await callNativeTool(fixture.session, "mcp__synthetic__binary");
      expect(binary?.content).toEqual([expect.objectContaining({ text: expect.stringContaining("was not saved") })]);
      await expect(readFile(fixture.logPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await fixture.close(); }
  }, 20_000);

  it("discovers deferred native tools through Pi tool_search without a proxy", async () => {
    const fixture = await createNativeMcpFixture({ exposure: "deferred" });
    try {
      expect(fixture.session.getActiveToolNames()).not.toContain("mcp__synthetic__echo");
      expect(fixture.session.getToolDefinition("mcp")).toBeUndefined();
      expect(await callNativeTool(fixture.session, "tool_search", { query: "echo" })).toMatchObject({ isError: false });
      expect(fixture.session.getActiveToolNames()).toContain("mcp__synthetic__echo");
      expect(await callNativeTool(fixture.session, "mcp__synthetic__echo")).toMatchObject({ isError: false });
    } finally { await fixture.close(); }
  }, 20_000);

  it("keeps legacy prefixed exclusions hidden from discovery and execution", async () => {
    const fixture = await createNativeMcpFixture({ excludeTools: ["synthetic_delete_file"] });
    try {
      expect(fixture.session.getActiveToolNames()).not.toContain("mcp__synthetic__delete_file");
      expect(await callNativeTool(fixture.session, "mcp__synthetic__delete_file"))
        .toMatchObject({ isError: true });
      expect((await fixture.records()).filter((event) => event.type === "call")).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 20_000);

  it("applies privacy and admitted-server policy to native resource tools", async () => {
    const fixture = await createNativeMcpFixture();
    try {
      for (const tool of ["list_mcp_resources", "list_mcp_resource_templates"]) {
        const result = await callNativeTool(fixture.session, tool, { server: "synthetic" });
        expect(result?.isError).toBe(false);
        expect(result?.details).not.toHaveProperty("fullOutputPath");
        expect(result?.content).toEqual([expect.objectContaining({ text: expect.stringContaining("output persistence is disabled") })]);
      }
      const result = await callNativeTool(fixture.session, "read_mcp_resource", { server: "synthetic", uri: "synthetic://blob.bin" });
      expect(result?.isError).toBe(false);
      expect(result?.content).toEqual([expect.objectContaining({ text: expect.stringContaining("was not saved") })]);
      expect(result?.details).not.toHaveProperty("fullOutputPath");
      expect(await callNativeTool(fixture.session, "read_mcp_resource", { server: "unadmitted", uri: "synthetic://blob.bin" }))
        .toMatchObject({ isError: true });
      expect((await fixture.records()).filter((event) => event.type === "read")).toHaveLength(1);
      await expect(readFile(`${fixture.agentDir}/mcp.log`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await fixture.close(); }
  }, 20_000);

  it("does not connect extension-registered servers through all-server resource discovery", async () => {
    const fixture = await createNativeMcpFixture({ registeredServer: true });
    try {
      const result = await callNativeTool(fixture.session, "list_mcp_resources");
      expect(result?.isError).toBe(false);
      expect(JSON.stringify(result?.content)).not.toContain("unadmitted");
      expect(fixture.session.getAllTools().some((tool) => tool.name.startsWith("mcp__unadmitted__"))).toBe(false);
      expect((await fixture.records()).filter((event) => event.type === "start")).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 20_000);

  it("refuses native OAuth login explicitly in Desktop", async () => {
    const fixture = await createNativeMcpFixture();
    try {
      await fixture.session.prompt("/mcp login synthetic");
      expect(JSON.stringify(fixture.uiEvents.mock.calls)).toContain("MCP OAuth login is disabled by the host.");
      expect((await fixture.records()).filter((event) => event.type === "call")).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 20_000);

  it("sends cancellation and accepts the next tool call on the same connection", async () => {
    const fixture = await createNativeMcpFixture();
    try {
      const prompt = callNativeTool(fixture.session, "mcp__synthetic__hold");
      await vi.waitFor(async () => expect((await fixture.records()).some((event) => event.name === "hold")).toBe(true));
      await fixture.session.abort();
      await prompt;
      await vi.waitFor(async () => {
        const records = await fixture.records();
        const call = records.find((event) => event.name === "hold");
        expect(records.find((event) => event.type === "cancel")?.id).toBe(call?.id);
      });
      expect(fixture.session.isStreaming).toBe(false);
      const next = await callNativeTool(fixture.session, "mcp__synthetic__echo");
      expect(next).toMatchObject({ isError: false, content: [{ type: "text", text: "echo" }] });
      expect((await fixture.records()).filter((event) => event.type === "start")).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 20_000);

  it("closes the old process tree on reload and calls the replacement server", async () => {
    const fixture = await createNativeMcpFixture();
    try {
      const old = (await fixture.records()).find((event) => event.type === "start")!;
      await fixture.session.reload();
      await vi.waitFor(async () => {
        expect(isProcessAlive(old.pid)).toBe(false);
        expect(isProcessAlive(old.childPid!)).toBe(false);
        expect((await fixture.records()).filter((event) => event.type === "start")).toHaveLength(2);
        expect(fixture.session.getToolDefinition("mcp__synthetic__echo")).toBeDefined();
      }, { timeout: 5_000 });
      expect(await callNativeTool(fixture.session, "mcp__synthetic__echo")).toMatchObject({ isError: false });
      const starts = (await fixture.records()).filter((event) => event.type === "start");
      expect(starts[1]?.pid).not.toBe(old.pid);
    } finally { await fixture.close(); }
  }, 20_000);

  it("closes an initializing server before shutdown returns", async () => {
    const fixture = await createNativeMcpFixture({ pendingInitialize: true });
    try {
      await vi.waitFor(async () => expect((await fixture.records()).filter((event) => event.type === "start")).toHaveLength(1));
      expect(fixture.session.getToolDefinition("mcp__synthetic__echo")).toBeUndefined();
      const start = (await fixture.records()).find((event) => event.type === "start")!;
      await fixture.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      expect(isProcessAlive(start.pid)).toBe(false);
      expect(isProcessAlive(start.childPid!)).toBe(false);
    } finally {
      // close emits the real public shutdown event and asserts both PIDs exited.
      await fixture.close();
    }
  }, 20_000);

  // Windows uses taskkill /T /F, not POSIX signals.
  it.skipIf(process.platform === "win32").each(["delayed", "ignored"] as const)("closes a POSIX descendant with %s SIGTERM handling before shutdown returns", async descendantTermination => {
    const fixture = await createNativeMcpFixture({ pendingInitialize: true, descendantTermination });
    try {
      // The handshake proves the signal handler is installed before shutdown starts.
      await vi.waitFor(async () => expect((await fixture.records()).some(event => event.type === "child-ready")).toBe(true));
      const start = (await fixture.records()).find(event => event.type === "start")!;
      expect(isProcessAlive(start.pid)).toBe(true);
      expect(isProcessAlive(start.childPid!)).toBe(true);
      await fixture.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      // No post-shutdown wait or second shutdown: the public lifecycle must finish the tree.
      expect(isProcessAlive(start.pid)).toBe(false);
      expect(isProcessAlive(start.childPid!)).toBe(false);
    } finally { await fixture.close(); }
  }, 20_000);

  it.skipIf(process.platform === "win32")("waits for descendants after an established server exits with inherited stdio", async () => {
    const fixture = await createNativeMcpFixture({ descendantTermination: "ignored", descendantInheritsStdio: true });
    try {
      await vi.waitFor(async () => expect((await fixture.records()).some(event => event.type === "child-ready")).toBe(true));
      const start = (await fixture.records()).find(event => event.type === "start")!;
      process.kill(start.pid, "SIGTERM"); // Only the fixture's direct server, not its group.
      await vi.waitFor(() => expect(isProcessAlive(start.pid)).toBe(false));
      expect(isProcessAlive(start.childPid!)).toBe(true);
      await fixture.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      expect(isProcessAlive(start.childPid!)).toBe(false);
      expect(fixture.extensionErrors).toEqual([]);
    } finally { await fixture.close(); }
  }, 20_000);

  it.skipIf(process.platform === "win32")("reports an unconfirmed process group through the public shutdown error channel", async () => {
    const fixture = await createNativeMcpFixture({ pendingInitialize: true });
    let restoreKill: (() => void) | undefined;
    let start: Awaited<ReturnType<typeof fixture.records>>[number] | undefined;
    const terminateOwnedGroup = (pid: number) => {
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    try {
      await vi.waitFor(async () => expect((await fixture.records()).some(event => event.type === "start")).toBe(true));
      start = (await fixture.records()).find(event => event.type === "start")!;
      const groupPid = -start.pid;
      const kill = process.kill.bind(process);
      const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (pid === groupPid && signal === 0) throw Object.assign(new Error("Synthetic group inspection denied"), { code: "EPERM" });
        return kill(pid, signal);
      });
      restoreKill = () => spy.mockRestore();
      await fixture.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      expect(fixture.extensionErrors).toContainEqual(expect.objectContaining({ event: "session_shutdown", error: "MCP shutdown failed" }));
      expect(isProcessAlive(start.pid)).toBe(true); // Explicit failure, never a successful-close assertion.
    } finally {
      restoreKill?.();
      // Forced cleanup only after observing the public failure, limited to the owned synthetic group.
      if (start) {
        terminateOwnedGroup(start.pid);
        await vi.waitFor(() => expect(isProcessAlive(start!.pid) || isProcessAlive(start!.childPid!)).toBe(false), { timeout: 5_000 });
      }
      await fixture.close();
    }
  }, 20_000);
});
