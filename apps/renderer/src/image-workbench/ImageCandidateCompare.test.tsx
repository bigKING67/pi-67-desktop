import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compareSplitAt, ImageCompareFrame } from "./ImageCandidateCompare.js";

const frame = { left: 0, top: 0, width: 400, height: 500 };

describe("candidate compare", () => {
  it("shows the base revision on the left and clips the candidate to the right of the divider", () => {
    const html = renderToStaticMarkup(<ImageCompareFrame after="cand.png" baseRevision={21} before="base.png" frame={frame} split={30} onSplit={() => undefined} />);
    expect(html.indexOf('alt="修订 21" ')).toBeLessThan(html.indexOf('alt="候选"'));
    expect(html).toMatch(/alt="候选"[^>]*clip-path:inset\(0 0 0 30%\)/u);
    expect(html).toContain("left:30%");
    expect(html).toMatch(/data-side="before"[^>]*>修订 21</u);
    expect(html).toMatch(/data-side="after"[^>]*>候选</u);
    expect(html).toMatch(/aria-label="对比分界：左侧修订 21，右侧候选"[^>]*type="range"[^>]*value="30"/u);
  });

  it("follows the pointer exactly across the frame and stays inside it", () => {
    expect(compareSplitAt(150, 100, 400)).toBe(12.5);
    expect(compareSplitAt(90, 100, 400)).toBe(0);
    expect(compareSplitAt(600, 100, 400)).toBe(100);
    expect(compareSplitAt(10, 0, 0)).toBe(50);
  });
});
