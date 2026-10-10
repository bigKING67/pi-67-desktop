import { describe, expect, it, vi } from "vitest";

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: { subscribe: () => () => undefined, request: () => Promise.reject(new Error("no host")) }
}));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: vi.fn() }));

import { candidateReceiptLine, historySummary } from "./ImageInspectorPanels.js";
import { selectImageObjects } from "./ImageLayersPanel.js";

describe("candidate receipts", () => {
  it("reads the receipt in words and never claims visual quality or a cost", () => {
    expect(candidateReceiptLine({ model: "gpt-image-2.5-sunburst", quality: "high", size: "1088x1360", durationMs: 22_481 }))
      .toBe("gpt-image-2.5-sunburst · 高质量 · 1088×1360 · 用时 22 秒 · 费用未估计 · 画面质量未核验");
    expect(candidateReceiptLine({ model: "m", durationMs: 200 })).toBe("m · 用时 1 秒 · 费用未估计 · 画面质量未核验");
  });
});

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
