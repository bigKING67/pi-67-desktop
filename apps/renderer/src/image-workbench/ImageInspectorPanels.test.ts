import { describe, expect, it, vi } from "vitest";

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: { subscribe: () => () => undefined, request: () => Promise.reject(new Error("no host")) }
}));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: vi.fn() }));

import { historySummary } from "./ImageInspectorPanels.js";
import { selectImageObjects } from "./ImageLayersPanel.js";

describe("image history summaries", () => {
  it("shows the engine's English system summaries as product copy", () => {
    expect(historySummary({ author: "system", summary: "Create local image project" })).toBe("创建项目");
    expect(historySummary({ author: "system", summary: "Snapshot of source revision 4" })).toBe("复制自修订 4");
  });

  it("keeps human and Agent summaries verbatim", () => {
    expect(historySummary({ author: "agent", summary: "换成暖色影棚" })).toBe("换成暖色影棚");
    expect(historySummary({ author: "human", summary: "Snapshot of source revision 4" })).toBe("Snapshot of source revision 4");
  });
});

describe("image layers selector", () => {
  it("returns one stable empty list before the document loads, so the subscription settles", () => {
    expect(selectImageObjects({ document: undefined })).toBe(selectImageObjects({ document: undefined }));
  });
});
