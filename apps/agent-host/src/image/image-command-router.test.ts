import { describe, expect, it } from "vitest";
import { ImageCommandPayloadSchemas, type AgentCommand } from "@pi67/protocol";
import { UnavailableImageCommands, isImageCommand } from "./image-command-router.js";
import { HostCommandError } from "../protocol-error.js";

describe("image command router", () => {
  it("recognises exactly the protocol's image commands", () => {
    const declared = Object.keys(ImageCommandPayloadSchemas);
    expect(declared.length).toBeGreaterThan(0);
    for (const type of declared) expect(isImageCommand(type), type).toBe(true);
    for (const type of ["image.project.delete", "teamChat.dm.open", "session.catalog.query"]) expect(isImageCommand(type)).toBe(false);
  });

  it("fails closed with a typed recoverable refusal until the engine host lands", async () => {
    const command = { type: "image.project.list", payload: {} } as AgentCommand<"image.project.list">;
    const failure = await new UnavailableImageCommands().execute("workspace-1", command).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HostCommandError);
    expect(failure).toMatchObject({ code: "UNSUPPORTED", recoverable: true, details: { imageReason: "engine_unavailable", command: "image.project.list" } });
  });
});
