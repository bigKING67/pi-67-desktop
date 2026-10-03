import { describe, expect, it, vi } from "vitest";
import { DESKTOP_CODEMODE_EXTENSION_PATH } from "./codemode-extension.js";
import { builtinTool, extensionTool, safetyHandler, trustedPolicy } from "./safety-extension-test-fixture.js";

const registered = () => ({ ...builtinTool("codemode"), sourceInfo: {
  source: "inline", path: DESKTOP_CODEMODE_EXTENSION_PATH, scope: "temporary" as const, origin: "top-level" as const
} });
const event = { toolCallId: "root", toolName: "codemode", input: { code: "text('ready')" } };

describe("Desktop Codemode root admission", () => {
  it.each(["auto", "yolo"] as const)("admits only the verified sandbox without a blanket %s approval", async (taskToolMode) => {
    const request = vi.fn(async () => ({ status: "denied" as const }));
    const handler = safetyHandler({ ...trustedPolicy(), taskToolMode }, request, () => [registered()]);
    expect(await handler(event, { hasUI: false })).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["duplicate", [registered(), registered()]],
    ["extension replacement", [extensionTool("codemode")]],
    ["wrong inline owner", [{ ...registered(), sourceInfo: { ...registered().sourceInfo, path: "<inline:other>" } }]]
  ] as const)("rejects %s identity even in YOLO", async (_label, tools) => {
    const request = vi.fn(async () => ({ status: "allowed" as const }));
    const handler = safetyHandler({ ...trustedPolicy(), taskToolMode: "yolo" }, request, () => [...tools]);
    expect(await handler(event, { hasUI: true })).toMatchObject({ block: true, reason: expect.stringContaining("CODEMODE_IDENTITY_INVALID") });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects recursive containers, malformed arguments and a disabled Agent turn", async () => {
    const request = vi.fn(async () => ({ status: "allowed" as const }));
    const handler = safetyHandler(trustedPolicy(), request, () => [registered()]);
    for (const call of [
      { ...event, parentToolCallId: "outer" },
      { ...event, input: { code: 3 } },
      { ...event, input: { code: "text('ready')", extra: true } }
    ]) expect(await handler(call, { hasUI: true })).toMatchObject({ block: true });
    const disabled = safetyHandler({ ...trustedPolicy(), toolsDisabled: true }, request, () => [registered()]);
    expect(await disabled(event, { hasUI: true })).toMatchObject({ block: true, reason: expect.stringContaining("AGENT_TURN_NO_TOOLS") });
    expect(request).not.toHaveBeenCalled();
  });
});
