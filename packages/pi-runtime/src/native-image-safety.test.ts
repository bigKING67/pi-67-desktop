import { describe, expect, it, vi } from "vitest";
import { extensionTool, safetyHandler, sdkTool, trustedPolicy } from "./safety-extension-test-fixture.js";
import type { DesktopApprovalRequester } from "./safety-extension.js";

const input = { provider: "fixture", model: "image", prompt: "draw a test image" };
const tools = () => [sdkTool("image_models"), sdkTool("generate_image")];
const event = { toolCallId: "image-call", toolName: "generate_image", input };

describe("SDK-native image authorization", () => {
  it("allows bounded discovery without approval in AUTO and PLAN", async () => {
    const request = vi.fn(async () => ({ status: "denied" as const }));
    for (const interaction of ["execute", "plan"] as const) {
      const handler = safetyHandler(trustedPolicy(), request, tools, undefined, undefined, () => interaction);
      expect(await handler({ ...event, toolName: "image_models", input: {} }, { hasUI: true })).toBeUndefined();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("asks once per AUTO generation with exact model identity and no prompt in the approval", async () => {
    const request = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "allowed" });
    const handler = safetyHandler(trustedPolicy(), request, tools);
    expect(await handler(event, { hasUI: true })).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ category: "external-submit", target: "fixture/image", scope: "single-tool-call" });
    expect(JSON.stringify(request.mock.calls)).not.toContain(input.prompt);
    expect(await handler({ ...event, toolCallId: "second" }, { hasUI: true })).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects generation in PLAN, untrusted and tools-disabled contexts", async () => {
    const request = vi.fn(async () => ({ status: "allowed" as const }));
    for (const handler of [
      safetyHandler(trustedPolicy(), request, tools, undefined, undefined, () => "plan"),
      safetyHandler({ ...trustedPolicy(), trust: "untrusted" }, request, tools),
      safetyHandler({ ...trustedPolicy(), toolsDisabled: true }, request, tools)
    ]) expect(await handler(event, { hasUI: true })).toMatchObject({ block: true });
    expect(request).not.toHaveBeenCalled();
  });

  it("admits valid YOLO generation but rejects malformed and forged identities", async () => {
    const request = vi.fn(async () => ({ status: "allowed" as const }));
    const policy = { ...trustedPolicy(), taskToolMode: "yolo" as const };
    const handler = safetyHandler(policy, request, tools);
    expect(await handler(event, { hasUI: true })).toBeUndefined();
    for (const badInput of [{ ...input, prompt: " " }, { ...input, apiKey: "must-not-be-accepted" },
      { ...input, referencePaths: ["a", "b", "c", "d", "e"] }]) {
      expect(await handler({ ...event, input: badInput }, { hasUI: true })).toMatchObject({ block: true });
    }
    for (const invalid of [[], [extensionTool("generate_image")], [sdkTool("generate_image"), sdkTool("generate_image")]]) {
      expect(await safetyHandler(policy, request, () => invalid)(event, { hasUI: true })).toMatchObject({ block: true });
    }
    expect(request).not.toHaveBeenCalled();
  });
});
