import { describe, expect, it } from "vitest";
import { teamChatAttachmentIsInlineImage, teamChatAttachmentRejection } from "./team-chat-attachments.js";

describe("team chat attachments", () => {
  it("refuses files the service would refuse", () => {
    expect(teamChatAttachmentRejection({ name: "季度 截图.PNG", size: 10 })).toBeUndefined();
    expect(teamChatAttachmentRejection({ name: "a.tar.gz", size: 10 })).toBeUndefined();
    expect(teamChatAttachmentRejection({ name: "setup.exe", size: 10 })).toBe("type");
    expect(teamChatAttachmentRejection({ name: "noext", size: 10 })).toBe("type");
    expect(teamChatAttachmentRejection({ name: "big.pdf", size: 25 * 1024 * 1024 + 1 })).toBe("size");
    expect(teamChatAttachmentRejection({ name: "empty.txt", size: 0 })).toBe("size");
    expect(teamChatAttachmentRejection({ name: ".env", size: 3 })).toBe("name");
  });

  it("shows only browser-renderable images inline", () => {
    expect(teamChatAttachmentIsInlineImage({ contentType: "image/png" })).toBe(true);
    expect(teamChatAttachmentIsInlineImage({ contentType: "image/heic" })).toBe(false);
    expect(teamChatAttachmentIsInlineImage({ contentType: "application/pdf" })).toBe(false);
  });
});
