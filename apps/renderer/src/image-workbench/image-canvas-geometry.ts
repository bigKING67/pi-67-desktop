// Canvas-space geometry for direct manipulation. The engine refuses any object
// that is not wholly inside the canvas, so every result here is clamped first;
// snapping and alignment only ever propose positions the engine will accept.

export interface Rect { x: number; y: number; width: number; height: number }
export interface CanvasSize { width: number; height: number }
/** A snap line in canvas units, drawn while the gesture lasts. */
export interface Guide { axis: "x" | "y"; at: number }
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdistribute" | "vdistribute";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function boundsOf(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x)), top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width)), bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Keeps a moved rectangle wholly on the canvas without changing its size. */
export function clampInside(rect: Rect, canvas: CanvasSize): Rect {
  return {
    ...rect,
    x: Math.round(Math.min(Math.max(rect.x, 0), canvas.width - rect.width)),
    y: Math.round(Math.min(Math.max(rect.y, 0), canvas.height - rect.height))
  };
}

const linesOf = (rect: Rect, axis: "x" | "y"): [number, number, number] => axis === "x"
  ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
  : [rect.y, rect.y + rect.height / 2, rect.y + rect.height];

function targetLines(targets: readonly Rect[], canvas: CanvasSize, axis: "x" | "y"): number[] {
  const size = axis === "x" ? canvas.width : canvas.height;
  return [0, size / 2, size, ...targets.flatMap((target) => linesOf(target, axis))];
}

/** The smallest shift (within `threshold`) that puts one of `moving` on one of `lines`. */
function nearest(moving: readonly number[], lines: readonly number[], threshold: number): { shift: number; at: number } | undefined {
  let best: { shift: number; at: number } | undefined;
  for (const from of moving) for (const at of lines) {
    const shift = at - from;
    if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at };
  }
  return best;
}

/**
 * Moves `start` by (dx, dy), snapping its edges or centre to the canvas edges,
 * the canvas centre and the other objects' edges and centres. Returns the
 * applied offset (so a group moves together) and the guides that matched.
 */
export function snapMove(start: Rect, dx: number, dy: number, targets: readonly Rect[], canvas: CanvasSize, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const moved = { ...start, x: start.x + dx, y: start.y + dy };
  const guides: Guide[] = [];
  const snapX = nearest(linesOf(moved, "x"), targetLines(targets, canvas, "x"), threshold);
  const snapY = nearest(linesOf(moved, "y"), targetLines(targets, canvas, "y"), threshold);
  if (snapX) { moved.x += snapX.shift; guides.push({ axis: "x", at: snapX.at }); }
  if (snapY) { moved.y += snapY.shift; guides.push({ axis: "y", at: snapY.at }); }
  const clamped = clampInside(moved, canvas);
  return { dx: clamped.x - start.x, dy: clamped.y - start.y, guides: guides.filter((guide) => guide.axis === "x" ? clamped.x === Math.round(moved.x) : clamped.y === Math.round(moved.y)) };
}

/**
 * Drags one handle of `start` by (dx, dy). The opposite edge stays put; the
 * moving edges snap to the same lines as a move, and Shift (`keepAspect`)
 * preserves the starting ratio. The result is whole pixels, at least 1×1 and
 * wholly on the canvas.
 */
export function resizeRect(start: Rect, handle: ResizeHandle, dx: number, dy: number, options: { keepAspect: boolean; targets: readonly Rect[]; canvas: CanvasSize; threshold: number }): { rect: Rect; guides: Guide[] } {
  const { canvas, threshold } = options;
  const west = handle.includes("w"), east = handle.includes("e"), north = handle.startsWith("n"), south = handle.startsWith("s");
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  const guides: Guide[] = [];
  const snapEdge = (value: number, axis: "x" | "y") => {
    const hit = nearest([value], targetLines(options.targets, canvas, axis), threshold);
    if (!hit) return value;
    guides.push({ axis, at: hit.at });
    return hit.at;
  };
  if (west) left = snapEdge(Math.min(start.x + dx, right - 1), "x");
  if (east) right = snapEdge(Math.max(right + dx, left + 1), "x");
  if (north) top = snapEdge(Math.min(start.y + dy, bottom - 1), "y");
  if (south) bottom = snapEdge(Math.max(bottom + dy, top + 1), "y");
  left = Math.max(0, left); top = Math.max(0, top); right = Math.min(canvas.width, right); bottom = Math.min(canvas.height, bottom);

  if (options.keepAspect && (west || east) && (north || south)) {
    const ratio = start.width / start.height;
    let width = right - left, height = bottom - top;
    if (width / height > ratio) width = height * ratio; else height = width / ratio;
    if (west) left = right - width; else right = left + width;
    if (north) top = bottom - height; else bottom = top + height;
    guides.length = 0;
  }
  const x = Math.round(left), y = Math.round(top);
  return { rect: { x, y, width: Math.max(1, Math.round(right) - x), height: Math.max(1, Math.round(bottom) - y) }, guides };
}

/**
 * Positions that align or distribute `rects`. One rectangle aligns to the
 * canvas; several align to their joint bounds. Distribution needs three or more
 * and spaces the gaps evenly, keeping the outermost two in place.
 */
export function alignRects<T extends Rect & { id: string }>(rects: readonly T[], mode: AlignMode, canvas: CanvasSize): { id: string; x: number; y: number }[] {
  if (rects.length === 0) return [];
  if (mode === "hdistribute" || mode === "vdistribute") return distribute(rects, mode === "hdistribute" ? "x" : "y");
  const frame = rects.length === 1 ? { x: 0, y: 0, ...canvas } : boundsOf(rects);
  return rects.map((rect) => {
    const position = { left: { x: frame.x }, hcenter: { x: frame.x + (frame.width - rect.width) / 2 }, right: { x: frame.x + frame.width - rect.width },
      top: { y: frame.y }, vcenter: { y: frame.y + (frame.height - rect.height) / 2 }, bottom: { y: frame.y + frame.height - rect.height } }[mode];
    const placed = clampInside({ ...rect, ...position }, canvas);
    return { id: rect.id, x: placed.x, y: placed.y };
  });
}

function distribute<T extends Rect & { id: string }>(rects: readonly T[], axis: "x" | "y"): { id: string; x: number; y: number }[] {
  if (rects.length < 3) return rects.map((rect) => ({ id: rect.id, x: rect.x, y: rect.y }));
  const size = axis === "x" ? "width" : "height";
  const ordered = [...rects].sort((a, b) => a[axis] - b[axis]);
  const first = ordered[0]!, last = ordered.at(-1)!;
  const gap = (last[axis] + last[size] - first[axis] - ordered.reduce((total, rect) => total + rect[size], 0)) / (ordered.length - 1);
  let cursor = first[axis];
  return ordered.map((rect) => {
    const at = Math.round(cursor);
    cursor += rect[size] + gap;
    return { id: rect.id, x: axis === "x" ? at : rect.x, y: axis === "y" ? at : rect.y };
  });
}

/** Degrees folded into −180…180 (180 rather than −180), rounded to 0.1°. */
export function normalizeRotation(degrees: number): number {
  const folded = ((degrees % 360) + 540) % 360 - 180;
  const rounded = Math.round((folded === -180 ? 180 : folded) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * The rotation after dragging a grip from `from` to `to` around `centre`, starting
 * at `start` degrees; with `step` (Shift: 15°) the result lands on its multiples.
 */
export function rotateAbout(start: number, centre: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }, step?: number): number {
  const angle = (point: { x: number; y: number }) => Math.atan2(point.y - centre.y, point.x - centre.x) * 180 / Math.PI;
  const turned = normalizeRotation(start + angle(to) - angle(from));
  return step ? normalizeRotation(Math.round(turned / step) * step) : turned;
}

/** The CSS that turns a box drawn over the canvas the way the engine turns the object. */
export const rotateStyle = (degrees: number | undefined): { transform?: string } => degrees ? { transform: `rotate(${degrees}deg)` } : {};
