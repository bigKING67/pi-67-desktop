import { describe, expect, it, vi } from "vitest";

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: { subscribe: () => () => undefined, request: () => Promise.reject(new Error("no host")) }
}));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: vi.fn() }));

import { candidateReceiptLine, historySummary } from "./ImageInspectorPanels.js";
import { selectImageObjects } from "./ImageLayersPanel.js";
import { imageObjectName } from "./image-object-kinds.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("candidate receipts", () => {
  it("reads the receipt in words and never claims visual quality or a cost", () => {
    expect(candidateReceiptLine({ model: "gpt-image-2.5-sunburst", quality: "high", size: "1088x1360", durationMs: 22_481 }))
      .toBe("gpt-image-2.5-sunburst · 高质量 · 1088×1360 · 用时 22 秒 · 费用未估计 · 画面质量未核验");
    expect(candidateReceiptLine({ model: "m", durationMs: 200 })).toBe("m · 用时 1 秒 · 费用未估计 · 画面质量未核验");
    expect(candidateReceiptLine({ model: "m", size: "10x10", durationMs: 5, reused: true })).toBe("m · 10×10 · 复用了之前的结果 · 未再次请求 · 画面质量未核验");
  });
});

describe("image history summaries", () => {
  it("shows the engine's English system summaries as product copy", () => {
    expect(historySummary({ author: "system", summary: "Create local image project" })).toBe("创建项目");
    expect(historySummary({ author: "system", summary: "Snapshot of source revision 4" })).toBe("复制自修订 4");
    expect(historySummary({ author: "system", summary: "Derived from spring-tea revision 23 for 4:5" })).toBe("派生自 spring-tea 修订 23 · 4:5");
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

describe("layer names", () => {
  it("names text by its words and default ids in product words, keeping ids the Agent chose", () => {
    const base = { locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1 };
    expect(imageObjectName({ ...base, id: "price", kind: "text", text: "¥39", font_size: 20, color: "#000000", align: "left", line_height: 1.2 })).toBe("¥39");
    expect(imageObjectName({ ...base, id: "photo", kind: "image", asset_id: "a", fit: "cover" })).toBe("照片");
    expect(imageObjectName({ ...base, id: "shape-2", kind: "rect", color: "#000000", radius: 0 })).toBe("矩形 2");
    expect(imageObjectName({ ...base, id: "hero_shot", kind: "image", asset_id: "a", fit: "cover" })).toBe("hero_shot");
    // A default id names only its own kind: an ellipse the Agent called `shape` stays `shape`.
    expect(imageObjectName({ ...base, id: "shape", kind: "ellipse", color: "#000000" })).toBe("shape");
  });
});

describe("library card meta", () => {
  it("keeps each fact whole and ends a line after its separator", async () => {
    const { CardMeta } = await import("./ImageLibrary.js");
    const html = renderToStaticMarkup(createElement(CardMeta, { parts: ["1920×1080", "修订 1", "10月10日"] }));
    expect(html.match(/<span class="[^"]*cardMetaPart[^"]*">[^<]*<\/span>/gu)?.map((part) => part.replace(/<[^>]+>/gu, ""))).toEqual(["1920×1080 ·", "修订 1 ·", "10月10日"]);
    // Plain spaces between the parts: visible, and where a line may break.
    expect(html.replace(/<[^>]+>/gu, "")).toBe("1920×1080 · 修订 1 · 10月10日");
  });
});
