import { SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createCodemodeFixture, resultText } from "./codemode.test-support.js";
import { DurableToolExecutionIndex } from "./durable-tool-execution-index.js";
import { normalizeMessages } from "./message-normalizer.js";
import type { DesktopApprovalDecision } from "./safety-extension.js";

describe("Desktop Codemode lifecycle and recovery", () => {
  it("cancels an in-flight MCP child and reuses the same connection", async () => {
    const f = await createCodemodeFixture();
    try {
      const prompt = f.run("text('before-abort'); await tools.mcp__synthetic__hold({});");
      await vi.waitFor(async () => expect((await f.records()).some((r) => r.name === "hold")).toBe(true));
      await f.session.abort();
      await prompt;
      await vi.waitFor(async () => {
        const records = await f.records();
        expect(records.find((r) => r.type === "cancel")?.id).toBe(records.find((r) => r.name === "hold")?.id);
      });
      expect(f.session.isStreaming).toBe(false);
      expect(f.events).toContainEqual(expect.objectContaining({
        type: "tool_execution_end", toolName: "mcp__synthetic__hold", isError: true,
        parentToolCallId: expect.any(String)
      }));
      expect(await f.run("text(await tools.mcp__synthetic__echo({}));")).toMatchObject({ isError: false });
      expect((await f.records()).filter((r) => r.type === "start")).toHaveLength(1);
    } finally { await f.close(); }
  }, 20_000);

  it("cancels pending nested approval without reaching the synthetic server", async () => {
    const f = await createCodemodeFixture();
    try {
      f.requestApproval.mockImplementation(async (request, { signal }) => {
        if (request.toolName === "codemode") return { status: "allowed" };
        return new Promise<DesktopApprovalDecision>((resolve) => {
          const cancel = () => resolve({ status: "cancelled", reason: "abort" });
          if (signal?.aborted) cancel();
          else signal?.addEventListener("abort", cancel, { once: true });
        });
      });
      const pending = f.run(`await tools.mcp__synthetic__delete_file({path: ${JSON.stringify(`${f.root}/owned.txt`)}});`);
      await vi.waitFor(() => expect(f.requestApproval.mock.calls.some(([r]) => r.toolName === "mcp__synthetic__delete_file")).toBe(true));
      await f.session.abort();
      await pending;
      expect((await f.records()).filter((r) => r.type === "call")).toHaveLength(0);
      expect(f.session.isStreaming).toBe(false);
    } finally { await f.close(); }
  }, 20_000);

  it("cancels unawaited work when a parallel script finishes", async () => {
    const f = await createCodemodeFixture();
    try {
      f.session.agent.toolExecution = "parallel";
      const result = await f.run("void tools.mcp__synthetic__hold({}); text(await tools.mcp__synthetic__echo({}));");
      expect(result?.isError).toBe(false);
      await vi.waitFor(async () => {
        const records = await f.records();
        const hold = records.find((r) => r.name === "hold");
        expect(hold).toBeDefined();
        expect(records.find((r) => r.type === "cancel")?.id).toBe(hold?.id);
      });
      expect((result!.details as { calls: unknown[] }).calls).toContainEqual(expect.objectContaining({
        name: "mcp__synthetic__hold", status: "cancelled"
      }));
    } finally { await f.close(); }
  }, 20_000);

  it("enforces a sandbox deadline and preserves partial output", async () => {
    const f = await createCodemodeFixture();
    try {
      const result = await f.run('// @options: {"timeout_ms": 150}\ntext("before-timeout"); while (true) {}');
      expect(result?.isError).toBe(true);
      expect(resultText(result)).toContain("before-timeout");
      expect(resultText(result)).toContain("timed out");
      expect(await f.run("text('after-timeout');")).toMatchObject({ isError: false });
    } finally { await f.close(); }
  }, 20_000);

  it("keeps successful store writes and discards writes from failed scripts", async () => {
    const f = await createCodemodeFixture();
    try {
      expect(await f.run("store('probe', 'committed');")).toMatchObject({ isError: false });
      const failed = await f.run("store('probe', 'uncommitted'); text('partial'); throw new Error('synthetic failure');");
      expect(failed?.isError).toBe(true);
      expect(resultText(failed)).toContain("partial");
      const restoredText = resultText(await f.run("text(load('probe'));"));
      expect(restoredText).toContain("committed");
      expect(restoredText).not.toContain("uncommitted");
      const entries = f.session.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "codemode-store");
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain("uncommitted");
    } finally { await f.close(); }
  }, 20_000);

  it("truncates large output without spilling the raw output", async () => {
    const f = await createCodemodeFixture();
    try {
      const result = await f.run('// @options: {"max_output_tokens": 16}\ntext("SYNTHETIC_CODEMODE_SPILL:" + "x".repeat(5000));');
      expect(result?.isError).toBe(false);
      expect(result!.details).not.toHaveProperty("fullOutputPath");
      expect(resultText(result)).not.toContain("Full output:");
      expect(resultText(result)).toContain("not saved");
    } finally { await f.close(); }
  }, 20_000);

  it("preserves live children and restores their native Pi summaries", async () => {
    const f = await createCodemodeFixture();
    try {
      const result = await f.run("text(await Promise.all([tools.mcp__synthetic__echo({}), tools.mcp__synthetic__echo({})]));");
      expect(result?.isError).toBe(false);
      const children = f.events.filter((e): e is Extract<AgentSessionEvent, { type: "tool_execution_end" }> =>
        e.type === "tool_execution_end" && Boolean(e.parentToolCallId));
      expect(children).toHaveLength(2);
      expect(new Set(children.map((e) => e.toolCallId)).size).toBe(2);
      const restored = new DurableToolExecutionIndex(f.root);
      const sessionFile = f.session.sessionManager.getSessionFile();
      expect(sessionFile).toBeDefined();
      const reopened = SessionManager.open(sessionFile!, f.session.sessionManager.getSessionDir());
      restored.rebuild(reopened.getBranch());
      for (const child of children) {
        const projected = f.projections.findLast((p) => p.toolCallId === child.toolCallId);
        expect(projected).toMatchObject({ toolName: "mcp__synthetic__echo", status: "completed", resultState: "present" });
        expect(projected).toHaveProperty("parentToolCallId", child.parentToolCallId);
        expect(restored.get(child.toolCallId)).toMatchObject({
          parentToolCallId: child.parentToolCallId, status: "completed", projectionSource: "durable"
        });
      }
      const view = normalizeMessages(reopened.getBranch().flatMap((entry) => entry.type === "message" ? [entry.message] : []));
      expect(view.flatMap((m) => m.parts).filter((p) => p.type === "tool-call" && p.name === "mcp__synthetic__echo")).toHaveLength(2);
      expect(view.filter((m) => m.toolName === "codemode")).toHaveLength(1);
      expect((result!.details as { calls: unknown[] }).calls).toHaveLength(2);
    } finally { await f.close(); }
  }, 20_000);
});
