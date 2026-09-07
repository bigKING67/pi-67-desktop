import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { projectMessagePage } from "./message-projection.js";
import { promptAttachmentMessage } from "./prompt-attachment.js";
import { VISION_ASSISTANCE_CONTEXT_TYPE, VISION_ASSISTANCE_ENTRY_TYPE } from "./vision-assistance.js";

function appendAttachments(manager: SessionManager): void {
  const control = promptAttachmentMessage({ id: "set-a", attachments: [{
    id: "doc-a", name: "brief.txt", mimeType: "text/plain", byteLength: 24, kind: "document"
  }] });
  manager.appendCustomMessageEntry(control.customType, control.content, control.display, control.details);
}

describe("persisted attachment message pagination", () => {
  it.each([false, true])("restores metadata across page boundaries with vision assistance=%s", (vision) => {
    const manager = SessionManager.inMemory("/workspace", { id: "attachment-session" });
    const first = manager.appendMessage({ role: "user", content: "Earlier", timestamp: 1 });
    appendAttachments(manager);
    if (vision) {
      manager.appendCustomEntry(VISION_ASSISTANCE_ENTRY_TYPE, {
        version: 1, provider: "fixture", model: "vision", createdAt: 2,
        attachments: [{ id: "image-a", name: "image.png", mimeType: "image/png", byteLength: 3 }],
        description: "Fixture image", usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        }
      });
      manager.appendCustomMessageEntry(VISION_ASSISTANCE_CONTEXT_TYPE, "Fixture vision context", false);
    }
    const attached = manager.appendMessage({ role: "user", content: "Read attached file", timestamp: 3 });
    manager.appendMessage({ role: "user", content: "Later", timestamp: 4 });
    const latest = projectMessagePage(manager, { limit: 1 });
    expect(latest.messages[0]?.parts).toEqual([{ type: "text", text: "Later" }]);
    const older = projectMessagePage(manager, { limit: 1, cursor: latest.messages[0]!.id });
    expect(older.messages).toHaveLength(1);
    expect(older.messages[0]).toMatchObject({ id: attached, parts: [
      { type: "text", text: "Read attached file" },
      { type: "attachment", id: "doc-a", name: "brief.txt" }
    ] });
    const preceding = projectMessagePage(manager, { limit: 1, cursor: attached });
    const newer = projectMessagePage(manager, {
      direction: "newer", limit: 1, cursor: preceding.messages[0]?.id ?? first
    });
    expect(newer.messages).toEqual(older.messages);
  });

  it("does not carry attachment metadata through an unrelated entry or message", () => {
    for (const barrier of ["custom", "user"] as const) {
      const manager = SessionManager.inMemory("/workspace");
      appendAttachments(manager);
      if (barrier === "custom") manager.appendCustomEntry("extension.unrelated", {});
      else manager.appendMessage({ role: "user", content: "Consumes attachment", timestamp: 1 });
      manager.appendMessage({ role: "user", content: "Unattached", timestamp: 2 });
      expect(projectMessagePage(manager, { limit: 1 }).messages[0]?.parts)
        .toEqual([{ type: "text", text: "Unattached" }]);
    }
  });
});
