import { describe, expect, it } from "vitest";
import { alignRects, clampInside, normalizeRotation, resizeRect, rotateAbout, snapMove } from "./image-canvas-geometry.js";

const canvas = { width: 1000, height: 800 };
const box = { x: 100, y: 100, width: 200, height: 100 };

describe("canvas geometry", () => {
  it("keeps moved objects wholly on the canvas, as the engine requires", () => {
    expect(clampInside({ ...box, x: -40, y: 760 }, canvas)).toEqual({ ...box, x: 0, y: 700 });
    expect(clampInside({ ...box, x: 950 }, canvas).x).toBe(800);
  });

  it("snaps a moving edge or centre to the canvas and to other objects", () => {
    // Centre 200 + 296 → 496, within 6 of the canvas centre 500.
    expect(snapMove(box, 296, 0, [], canvas, 6)).toEqual({ dx: 300, dy: 0, guides: [{ axis: "x", at: 500 }] });
    // Left edge 100 + 395 → 495 near the other object's right edge 500.
    const other = { x: 400, y: 400, width: 100, height: 100 };
    const snapped = snapMove(box, 395, 297, [other], canvas, 6);
    expect(snapped.dx).toBe(400);
    expect(snapped.dy).toBe(300);
    expect(snapped.guides).toEqual([{ axis: "x", at: 500 }, { axis: "y", at: 400 }]);
    // Nothing within the threshold: the raw offset, no guides.
    expect(snapMove(box, 37, 41, [], canvas, 6)).toEqual({ dx: 37, dy: 41, guides: [] });
  });

  it("drops a guide when the canvas clamp overrides the snap", () => {
    expect(snapMove(box, 2000, 0, [], canvas, 6)).toEqual({ dx: 700, dy: 0, guides: [] });
  });

  it("resizes from any handle, keeping the opposite edge fixed and staying on the canvas", () => {
    expect(resizeRect(box, "se", 50, 30, { keepAspect: false, targets: [], canvas, threshold: 0 }).rect).toEqual({ x: 100, y: 100, width: 250, height: 130 });
    expect(resizeRect(box, "nw", -150, -150, { keepAspect: false, targets: [], canvas, threshold: 0 }).rect).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(resizeRect(box, "w", 500, 0, { keepAspect: false, targets: [], canvas, threshold: 0 }).rect).toEqual({ x: 299, y: 100, width: 1, height: 100 });
    expect(resizeRect(box, "e", 5000, 0, { keepAspect: false, targets: [], canvas, threshold: 0 }).rect.width).toBe(900);
  });

  it("keeps the starting ratio on corner handles with Shift", () => {
    const { rect } = resizeRect(box, "se", 200, 10, { keepAspect: true, targets: [], canvas, threshold: 0 });
    expect(rect.width / rect.height).toBeCloseTo(2, 1);
    expect(rect).toEqual({ x: 100, y: 100, width: 220, height: 110 });
  });

  it("snaps the moving edge during a resize", () => {
    const { rect, guides } = resizeRect(box, "e", 197, 0, { keepAspect: false, targets: [], canvas, threshold: 6 });
    expect(rect.width).toBe(400);
    expect(guides).toEqual([{ axis: "x", at: 500 }]);
  });

  it("aligns one object to the canvas and several to their joint bounds", () => {
    expect(alignRects([{ id: "a", ...box }], "hcenter", canvas)).toEqual([{ id: "a", x: 400, y: 100 }]);
    expect(alignRects([{ id: "a", ...box }], "bottom", canvas)).toEqual([{ id: "a", x: 100, y: 700 }]);
    const pair = [{ id: "a", ...box }, { id: "b", x: 500, y: 300, width: 100, height: 50 }];
    expect(alignRects(pair, "right", canvas)).toEqual([{ id: "a", x: 400, y: 100 }, { id: "b", x: 500, y: 300 }]);
    expect(alignRects(pair, "top", canvas)).toEqual([{ id: "a", x: 100, y: 100 }, { id: "b", x: 500, y: 100 }]);
  });

  it("distributes three or more evenly, keeping the outer two", () => {
    const row = [
      { id: "c", x: 700, y: 0, width: 100, height: 10 },
      { id: "a", x: 0, y: 0, width: 100, height: 10 },
      { id: "b", x: 150, y: 0, width: 100, height: 10 }
    ];
    expect(alignRects(row, "hdistribute", canvas)).toEqual([{ id: "a", x: 0, y: 0 }, { id: "b", x: 350, y: 0 }, { id: "c", x: 700, y: 0 }]);
    expect(alignRects(row.slice(0, 2), "hdistribute", canvas)).toEqual([{ id: "c", x: 700, y: 0 }, { id: "a", x: 0, y: 0 }]);
  });
});

describe("rotation", () => {
  it("folds any angle into −180…180 and keeps 180", () => {
    expect([0, 90, 180, -180, 270, -270, 360, 359.96, -0.01].map(normalizeRotation)).toEqual([0, 90, 180, 180, -90, 90, 0, 0, 0]);
  });

  it("turns by the angle swept around the centre, snapping to the step with Shift", () => {
    const centre = { x: 100, y: 100 };
    // From straight up to straight right is a quarter turn clockwise (screen y points down).
    expect(rotateAbout(0, centre, { x: 100, y: 0 }, { x: 200, y: 100 })).toBe(90);
    expect(rotateAbout(170, centre, { x: 100, y: 0 }, { x: 200, y: 100 })).toBe(-100);
    expect(rotateAbout(0, centre, { x: 100, y: 0 }, { x: 120, y: 0 }, 15)).toBe(15);
    expect(rotateAbout(0, centre, { x: 100, y: 0 }, { x: 105, y: 0 }, 15)).toBe(0);
  });
});
