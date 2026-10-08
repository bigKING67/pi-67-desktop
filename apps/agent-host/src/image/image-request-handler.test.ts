import { describe, expect, it, vi } from "vitest";
import type { RequestEnvelope } from "@pi67/protocol";
import type { HostConnectionContext } from "../connection-context.js";
import { handleImageRequest } from "./image-request-handler.js";
import { ImageCommandRouter } from "./image-command-router.js";

function origin() {
  const sendError = vi.fn(), sendSuccess = vi.fn();
  return { origin: { sendError, sendSuccess } as unknown as HostConnectionContext, sendError, sendSuccess };
}
const request = (type: string, context: RequestEnvelope["context"]): RequestEnvelope =>
  ({ requestId: "r1", type, payload: {}, context }) as unknown as RequestEnvelope;
const workspace = { scope: "workspace", workspaceId: "w1" } as RequestEnvelope["context"];

describe("image request handler", () => {
  it("leaves non-image commands to the other routers", () => {
    const { origin: o, sendError, sendSuccess } = origin();
    expect(handleImageRequest(o, request("session.catalog.query", workspace))).toBe(false);
    expect(sendError).not.toHaveBeenCalled(); expect(sendSuccess).not.toHaveBeenCalled();
  });

  it("requires Workspace authority", () => {
    const { origin: o, sendError } = origin();
    expect(handleImageRequest(o, request("image.project.list", { scope: "app" } as RequestEnvelope["context"]))).toBe(true);
    expect(sendError).toHaveBeenCalledWith("r1", "image.project.list", expect.objectContaining({ code: "INVALID_PAYLOAD", recoverable: false }));
  });

  it("passes Workspace-scoped commands to the router and reports its refusal", async () => {
    const { origin: o, sendError, sendSuccess } = origin();
    const router = new ImageCommandRouter();
    const execute = vi.spyOn(router, "execute");
    expect(handleImageRequest(o, request("image.project.read", workspace), router)).toBe(true);
    expect(execute).toHaveBeenCalledWith("w1", { type: "image.project.read", payload: {} });
    await vi.waitFor(() => expect(sendError).toHaveBeenCalledWith("r1", "image.project.read", expect.objectContaining({ code: "UNSUPPORTED", details: expect.objectContaining({ imageReason: "engine_unavailable" }) })));
    expect(sendSuccess).not.toHaveBeenCalled();
  });

  it("returns router results as success", async () => {
    const { origin: o, sendSuccess } = origin();
    const router = new ImageCommandRouter();
    vi.spyOn(router, "execute").mockResolvedValue({ projects: [] } as never);
    handleImageRequest(o, request("image.project.list", workspace), router);
    await vi.waitFor(() => expect(sendSuccess).toHaveBeenCalledWith("r1", "image.project.list", { projects: [] }));
  });
});
