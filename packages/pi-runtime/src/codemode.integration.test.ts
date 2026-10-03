import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createCodemodeFixture, resultText } from "./codemode.test-support.js";
import { createNativeMcpFixture } from "./native-mcp.test-support.js";
import { createDesktopCodemodeExtension } from "./codemode-extension.js";

describe("Desktop native Codemode", () => {
  it("respects an explicit user default-tools selection", async () => {
    const f = await createNativeMcpFixture({ defaultTools: ["read"], additionalExtensions: [createDesktopCodemodeExtension(() => ["read"])] });
    try {
      expect(f.session.getAllTools().some((tool) => tool.name === "codemode")).toBe(true);
      expect(f.session.getActiveToolNames()).not.toContain("codemode");
    } finally { await f.close(); }
  }, 20_000);
  it.each(["direct", "deferred"] as const)("calls %s MCP through the admitted sandbox without a blanket approval", async (exposure) => {
    const f = await createCodemodeFixture({ exposure });
    try {
      const result = await f.run("text(await tools.mcp__synthetic__echo({})); text(typeof models); text(typeof process); text(typeof fetch);");
      expect(result).toMatchObject({ toolName: "codemode", isError: false });
      expect(resultText(result)).toContain("echo");
      expect(resultText(result).match(/undefined/g)).toHaveLength(3);
      expect(f.session.getActiveToolNames()).toContain("codemode");
      expect(f.requestApproval).not.toHaveBeenCalled();
      expect((await f.records()).filter((r) => r.type === "call").map((r) => r.name)).toEqual(["echo"]);
    } finally { await f.close(); }
  }, 20_000);

  it.each(["auto", "yolo"] as const)("keeps exact nested deletion confirmation in %s", async (mode) => {
    const f = await createCodemodeFixture({ mode });
    try {
      const result = await f.run(`await tools.mcp__synthetic__delete_file({path: ${JSON.stringify(`${f.root}/owned.txt`)}});`);
      expect(result?.isError).toBe(true);
      expect((await f.records()).filter((r) => r.type === "call")).toHaveLength(0);
      const requests = f.requestApproval.mock.calls.map(([request]) => request);
      const deletion = requests.find((r) => r.toolName === "mcp__synthetic__delete_file");
      // Current configured-MCP policy displays the tool name for an in-workspace
      // target. The child identity and validated arguments still bind this call.
      expect(deletion).toMatchObject({ category: "bulk-delete", scope: "single-tool-call", target: "delete_file" });
      const child = f.events.find((e) => e.type === "tool_execution_start" && e.toolName === "mcp__synthetic__delete_file");
      expect(child).toMatchObject({ toolCallId: deletion?.toolCallId, parentToolCallId: expect.any(String),
        args: { path: `${f.root}/owned.txt` } });
    } finally { await f.close(); }
  }, 20_000);

  it("rejects the sandbox root in an untrusted Workspace", async () => {
    const f = await createCodemodeFixture({ trust: "untrusted" });
    try {
      const result = await f.run("text(await tools.ls({path: '.'}));");
      expect(result?.isError).toBe(true);
      expect(resultText(result)).toContain("CODEMODE_WORKSPACE_UNTRUSTED");
      expect(f.requestApproval).not.toHaveBeenCalled();
      expect((await f.records()).filter((r) => r.type === "call")).toHaveLength(0);
    } finally { await f.close(); }
  }, 20_000);

  it("preserves PLAN leaf policy after admitting the exact Desktop sandbox root", async () => {
    const f = await createCodemodeFixture({ interaction: "plan" });
    try {
      const result = await f.run(`text(await Promise.allSettled([
        tools.read({path: ${JSON.stringify(`${f.agentDir}/mcp.json`)}}),
        tools.write({path: ${JSON.stringify(`${f.root}/must-not-exist`)}, content: 'blocked'}),
        tools.mcp__synthetic__delete_file({path: ${JSON.stringify(`${f.root}/owned.txt`)}})
      ]));`);
      expect(result?.isError).toBe(false);
      expect(resultText(result)).toContain("fulfilled");
      expect(resultText(result).match(/rejected/g)).toHaveLength(2);
      expect(f.requestApproval).not.toHaveBeenCalled();
      expect((await f.records()).filter((r) => r.type === "call")).toHaveLength(0);
      const ends = f.events.filter((e) => e.type === "tool_execution_end" && e.parentToolCallId);
      expect(ends).toHaveLength(3);
      expect(ends.filter((e) => e.type === "tool_execution_end" && e.isError)).toHaveLength(2);
      await expect(access(`${f.root}/must-not-exist`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await f.close(); }
  }, 20_000);

  it("approves one synthetic deletion without granting the next child call", async () => {
    const f = await createCodemodeFixture();
    try {
      let deletions = 0;
      f.requestApproval.mockImplementation(async (request) => ({ status:
        request.toolName === "codemode" || ++deletions === 1 ? "allowed" : "denied" }));
      const result = await f.run(`const args = {path: ${JSON.stringify(`${f.root}/owned.txt`)}};
        text(await tools.mcp__synthetic__delete_file(args));
        await tools.mcp__synthetic__delete_file(args);`);
      expect(result?.isError).toBe(true);
      expect(resultText(result)).toContain("delete_file");
      const requests = f.requestApproval.mock.calls.map(([r]) => r).filter((r) => r.toolName !== "codemode");
      expect(requests).toHaveLength(2);
      expect(new Set(requests.map((r) => r.toolCallId)).size).toBe(2);
      expect((await f.records()).filter((r) => r.type === "call").map((r) => r.name)).toEqual(["delete_file"]);
    } finally { await f.close(); }
  }, 20_000);

  it("rejects invalid schema and unknown or hidden tools before MCP execution", async () => {
    const f = await createCodemodeFixture({ mode: "yolo", excludeTools: ["delete_file"] });
    try {
      const result = await f.run(`
        text(ALL_TOOLS.some(t => t.name === 'mcp__synthetic__delete_file'));
        text(await describeTool('mcp__synthetic__delete_file'));
        text(await Promise.allSettled([
          tools.mcp__synthetic__echo({unexpected: true}),
          Promise.resolve().then(() => tools.mcp__synthetic__missing({})),
          Promise.resolve().then(() => tools.mcp__synthetic__delete_file({}))
        ]));`);
      expect(result?.isError).toBe(false);
      expect(resultText(result)).toContain("false");
      expect(resultText(result)).toContain("undefined");
      expect(resultText(result).match(/rejected/g)).toHaveLength(3);
      expect((await f.records()).filter((r) => r.type === "call")).toHaveLength(0);
      expect(f.requestApproval).not.toHaveBeenCalled();
    } finally { await f.close(); }
  }, 20_000);

  it("finds deferred native tools without exposing the model catalog", async () => {
    const f = await createCodemodeFixture({ exposure: "deferred" });
    try {
      const result = await f.run(`
        const found = await searchTools('echo', {namespace: 'mcp__synthetic'});
        text(found.map(t => t.name));
        text((await describeNamespace('mcp__synthetic')).name);
        text(await tools.mcp__synthetic__echo({}));`);
      expect(result?.isError).toBe(false);
      expect(resultText(result)).toContain("mcp__synthetic__echo");
      expect(resultText(result)).toContain("mcp__synthetic");
    } finally { await f.close(); }
  }, 20_000);
});
