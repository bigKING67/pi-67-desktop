import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImageAdjustments } from "./ImageAdjustments.js";

vi.mock("./image-project-controller.js", () => ({ editImageProject: vi.fn() }));

const photo = { id: "photo", kind: "image" as const, locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, asset_id: "a", fit: "cover" as const };

describe("image adjustments", () => {
  it("reads factors as −100…+100 around unchanged and blur in pixels, and offers 还原 only while adjusted", () => {
    const html = renderToStaticMarkup(<ImageAdjustments busy={false} object={{ ...photo, adjust: { brightness: 1.2, saturation: 0.35, blur: 4 } }} onResult={() => undefined} />);
    for (const value of ["+20", ">0<", "-65", "4 px"]) expect(html).toContain(value);
    expect(html).toContain("还原调整");
    expect(renderToStaticMarkup(<ImageAdjustments busy={false} object={photo} onResult={() => undefined} />)).not.toContain("还原调整");
  });
});
