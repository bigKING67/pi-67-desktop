import type { ImageDocument, ImageEditOperation, ImageMark, ImageObjectPatch, ImageSceneObject as SceneObject } from "@pi67/domain";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { boundsOf, clampInside, normalizeRotation, RESIZE_HANDLES, resizeRect, rotateAbout, rotateStyle, snapMove, type Guide, type Rect, type ResizeHandle } from "./image-canvas-geometry.js";
import { useCanvasFit } from "./image-canvas-fit.js";
import { ImageInlineTextEditor } from "./ImageInlineTextEditor.js";
import { IMAGE_OBJECT_KIND_LABELS } from "./image-object-kinds.js";
import styles from "./ImageCanvas.module.css";

/** Snap distance in screen pixels, converted to canvas units by the fit scale. */
const SNAP_PX = 6;

type Gesture =
  | { kind: "move"; ids: string[]; startX: number; startY: number; dx: number; dy: number; guides: Guide[] }
  | { kind: "resize"; id: string; handle: ResizeHandle; startX: number; startY: number; rect: Rect; guides: Guide[] }
  | { kind: "rotate"; id: string; centre: { x: number; y: number }; from: { x: number; y: number }; start: number; rotation: number; guides: Guide[] };

/** Keyboard turns: `]` clockwise, `[` anticlockwise, 15° a press (Shift: 1°). By key position, since Shift turns them into `}` / `{`. */
const ROTATE_KEYS: Readonly<Record<string, number>> = { BracketRight: 1, BracketLeft: -1 };
/** Room the grip needs above a box; nearer the top of the well it goes below the box. */
const GRIP_ROOM = 34;
const ROTATE_STEP = 15;

const rectOf = ({ x, y, width, height }: SceneObject): Rect => ({ x, y, width, height });

/**
 * The fitted canvas: the rendered PNG plus a box per visible object in canvas
 * coordinates. Shift-click builds a selection; unlocked selected objects drag
 * together and the primary one resizes from eight handles, both snapping to the
 * canvas and to other objects (hold ⌘/Ctrl to place freely). Each gesture
 * commits once, when the pointer lifts. Rendering stays the engine's. In mark
 * mode a layer above the boxes draws regions instead; marks always show.
 */
export function ImageCanvas({ document, src, alt, selectedIds, editable, onSelect, onEdit, marks = [], marking = false, onMark }: {
  document: ImageDocument | undefined;
  src: string | undefined;
  alt: string;
  selectedIds: readonly string[];
  editable: boolean;
  onSelect: (objectId: string | undefined, options?: { extend?: boolean }) => void;
  onEdit: (summary: string, operations: ImageEditOperation[]) => void;
  marks?: readonly ImageMark[];
  marking?: boolean;
  onMark?: (rect: Rect) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>();
  const [editingId, setEditingId] = useState<string>();
  const [drawing, setDrawing] = useState<{ start: { x: number; y: number }; rect: Rect }>();
  const canvas = document?.canvas;
  const fit = useCanvasFit(stage, canvas);

  const objects = document?.objects.filter((object) => object.visible) ?? [];
  const movable = (ids: readonly string[]) => objects.filter((object) => ids.includes(object.id) && !object.locked);
  const others = (ids: readonly string[]) => objects.filter((object) => !ids.includes(object.id)).map(rectOf);
  const primary = objects.find((object) => object.id === selectedIds.at(-1));
  const editingObject = editable ? objects.find((object) => object.id === editingId && object.kind === "text" && !object.locked) : undefined;
  const editing = editingObject?.kind === "text" ? editingObject : undefined;
  const handled = editable && !marking && !editing && selectedIds.length === 1 && primary && !primary.locked ? primary : undefined;
  // The eight handles assume an upright box; a turned object resizes through 属性 and keeps only the rotate grip.
  const resizable = handled && !handled.rotation ? handled : undefined;
  const rotationOf = (object: SceneObject): number => gesture?.kind === "rotate" && gesture.id === object.id ? gesture.rotation : object.rotation ?? 0;
  const commitRotation = (object: SceneObject, rotation: number) => {
    if (rotation === (object.rotation ?? 0)) return;
    onEdit("旋转", [{ type: "update_object", id: object.id, patch: { rotation: rotation || null } }]);
  };

  const commitMove = (ids: readonly string[], dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    onEdit("移动", movable(ids).map((object) => ({ type: "update_object", id: object.id, patch: { x: object.x + dx, y: object.y + dy } })));
  };
  const commitResize = (object: SceneObject, rect: Rect) => {
    if (rect.x === object.x && rect.y === object.y && rect.width === object.width && rect.height === object.height) return;
    const patch: ImageObjectPatch = { ...rect };
    // The engine caps a rectangle's radius at half its shorter side.
    if (object.kind === "rect" && object.radius > Math.min(rect.width, rect.height) / 2) patch.radius = Math.floor(Math.min(rect.width, rect.height) / 2);
    onEdit("调整大小", [{ type: "update_object", id: object.id, patch }]);
  };

  const pointerDown = (event: PointerEvent<HTMLButtonElement>, object: SceneObject) => {
    if (event.button !== 0) return;
    if (event.shiftKey) { onSelect(object.id, { extend: true }); return; }
    const ids = selectedIds.includes(object.id) ? selectedIds : [object.id];
    if (!selectedIds.includes(object.id)) onSelect(object.id);
    if (!editable || movable(ids).length === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ kind: "move", ids: [...ids], startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, guides: [] });
  };
  const handleDown = (event: PointerEvent<HTMLSpanElement>, object: SceneObject, handle: ResizeHandle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ kind: "resize", id: object.id, handle, startX: event.clientX, startY: event.clientY, rect: rectOf(object), guides: [] });
  };
  const gripDown = (event: PointerEvent<HTMLSpanElement>, object: SceneObject) => {
    const well = stage.current?.getBoundingClientRect();
    if (event.button !== 0 || !fit || !well) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // The engine turns about the stored box's centre; the same point on screen, from the fit.
    const centre = { x: well.left + fit.left + (object.x + object.width / 2) * fit.scale, y: well.top + fit.top + (object.y + object.height / 2) * fit.scale };
    setGesture({ kind: "rotate", id: object.id, centre, from: { x: event.clientX, y: event.clientY }, start: object.rotation ?? 0, rotation: object.rotation ?? 0, guides: [] });
  };
  const pointerMove = (event: PointerEvent) => {
    if (gesture?.kind === "rotate") {
      setGesture({ ...gesture, rotation: rotateAbout(gesture.start, gesture.centre, gesture.from, { x: event.clientX, y: event.clientY }, event.shiftKey ? ROTATE_STEP : undefined) });
      return;
    }
    if (!gesture || !fit || !canvas) return;
    const dx = (event.clientX - gesture.startX) / fit.scale, dy = (event.clientY - gesture.startY) / fit.scale;
    const threshold = event.metaKey || event.ctrlKey ? 0 : SNAP_PX / fit.scale;
    if (gesture.kind === "move") {
      const group = movable(gesture.ids);
      if (group.length === 0) return;
      setGesture({ ...gesture, ...snapMove(boundsOf(group.map(rectOf)), dx, dy, others(gesture.ids), canvas, threshold) });
      return;
    }
    const object = objects.find((item) => item.id === gesture.id);
    if (!object) return;
    setGesture({ ...gesture, ...resizeRect(rectOf(object), gesture.handle, dx, dy, { keepAspect: event.shiftKey, targets: others([object.id]), canvas, threshold }) });
  };
  const pointerUp = () => {
    if (gesture?.kind === "move") commitMove(gesture.ids, gesture.dx, gesture.dy);
    if (gesture?.kind === "resize") { const object = objects.find((item) => item.id === gesture.id); if (object) commitResize(object, gesture.rect); }
    if (gesture?.kind === "rotate") { const object = objects.find((item) => item.id === gesture.id); if (object) commitRotation(object, gesture.rotation); }
    setGesture(undefined);
  };
  const startEditing = (object: SceneObject) => {
    if (!editable || object.kind !== "text" || object.locked) return;
    setGesture(undefined);
    onSelect(object.id);
    setEditingId(object.id);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, object: SceneObject) => {
    if (event.key === "Escape") { onSelect(undefined); return; }
    // Enter opens the words for editing, the keyboard twin of double-click.
    if (event.key === "Enter" && object.kind === "text") { event.preventDefault(); startEditing(object); return; }
    const turn = ROTATE_KEYS[event.code];
    if (turn && editable && !object.locked) {
      event.preventDefault();
      commitRotation(object, normalizeRotation((object.rotation ?? 0) + turn * (event.shiftKey ? 1 : ROTATE_STEP)));
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta || !editable || !canvas) return;
    event.preventDefault();
    // Alt + arrows resize the focused object from its bottom-right corner; arrows alone move the selection.
    if (event.altKey) {
      if (!object.locked) commitResize(object, resizeRect(rectOf(object), "se", delta[0]!, delta[1]!, { keepAspect: false, targets: [], canvas, threshold: 0 }).rect);
      return;
    }
    const ids = selectedIds.includes(object.id) ? selectedIds : [object.id];
    const group = movable(ids);
    if (group.length === 0) return;
    const start = boundsOf(group.map(rectOf)), placed = clampInside({ ...start, x: start.x + delta[0]!, y: start.y + delta[1]! }, canvas);
    commitMove(ids, placed.x - start.x, placed.y - start.y);
  };

  const frameOf = (object: SceneObject): Rect => {
    if (gesture?.kind === "resize" && gesture.id === object.id) return gesture.rect;
    if (gesture?.kind === "move" && gesture.ids.includes(object.id) && !object.locked) return { ...rectOf(object), x: object.x + gesture.dx, y: object.y + gesture.dy };
    return rectOf(object);
  };
  // Mark drawing works in canvas pixels, clamped to the canvas.
  const canvasPoint = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
    return { x: clamp((event.clientX - box.left) / fit!.scale, canvas!.width), y: clamp((event.clientY - box.top) / fit!.scale, canvas!.height) };
  };
  const drawDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !fit || !canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = canvasPoint(event);
    setDrawing({ start, rect: { ...start, width: 0, height: 0 } });
  };
  const drawMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const point = canvasPoint(event), { start } = drawing;
    setDrawing({ start, rect: { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) } });
  };
  const drawUp = () => {
    if (drawing) onMark?.(drawing.rect);
    setDrawing(undefined);
  };

  const place = (rect: Rect, scale: number) => ({ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale });

  return (
    <div ref={stage} className={styles.stage} onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(undefined); }}>
      {src ? <img alt={alt} className={styles.image} src={src} /> : null}
      {fit && canvas && src ? (
        <div className={styles.overlay} style={{ left: fit.left, top: fit.top, width: canvas.width * fit.scale, height: canvas.height * fit.scale }}>
          {/* Topmost first for focus order; z-index restores paint order for hit testing. */}
          {objects.map((object, index) => ({ object, index })).reverse().map(({ object, index }) => {
            const selected = selectedIds.includes(object.id);
            return (
              <button
                key={object.id}
                aria-label={`${objectLabel(object)}${object.locked ? "（已锁定）" : ""}`}
                aria-pressed={selected}
                className={`${styles.box} ${selected ? styles.selected : ""} ${object.locked ? styles.locked : ""}`}
                data-object-id={object.id}
                style={{ ...place(frameOf(object), fit.scale), zIndex: index + 1, ...rotateStyle(rotationOf(object)) }}
                type="button"
                onDoubleClick={() => startEditing(object)}
                onKeyDown={(event) => keyDown(event, object)}
                onPointerCancel={() => setGesture(undefined)}
                onPointerDown={(event) => pointerDown(event, object)}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
              />
            );
          })}
          {handled ? (
            <div aria-hidden="true" className={styles.handles} data-grip={fit.top + handled.y * fit.scale < GRIP_ROOM ? "below" : "above"}
              style={{ ...place(frameOf(handled), fit.scale), ...rotateStyle(rotationOf(handled)) }}>
              {resizable ? RESIZE_HANDLES.map((handle) => (
                <span key={handle} className={styles.handle} data-handle={handle}
                  onPointerCancel={() => setGesture(undefined)} onPointerDown={(event) => handleDown(event, resizable, handle)}
                  onPointerMove={pointerMove} onPointerUp={pointerUp} />
              )) : null}
              <span className={styles.rotateGrip} data-testid="image-rotate-grip" title="拖动旋转，按住 Shift 每次 15°"
                onPointerCancel={() => setGesture(undefined)} onPointerDown={(event) => gripDown(event, handled)}
                onPointerMove={pointerMove} onPointerUp={pointerUp} />
            </div>
          ) : null}
          {/* The angle reads upright beside the box centre, whatever the turn. */}
          {gesture?.kind === "rotate" && handled ? (
            <span aria-live="polite" className={styles.rotateReadout}
              style={{ left: (handled.x + handled.width / 2) * fit.scale, top: (handled.y + handled.height / 2) * fit.scale }}>{gesture.rotation}°</span>
          ) : null}
          {editing ? (
            <ImageInlineTextEditor key={editing.id} frame={place(rectOf(editing), fit.scale)} object={editing} scale={fit.scale}
              onClose={() => {
                setEditingId(undefined);
                // Focus returns to the object the words belong to.
                requestAnimationFrame(() => stage.current?.querySelector<HTMLButtonElement>(`[data-object-id="${editing.id}"]`)?.focus());
              }} />
          ) : null}
          {marks.map((mark) => (
            <span key={mark.id} aria-hidden="true" className={styles.mark} data-empty={mark.instruction.trim() ? undefined : "true"} style={place(mark, fit.scale)}>
              <span className={styles.markTag}>{mark.id}</span>
            </span>
          ))}
          {drawing ? <span aria-hidden="true" className={styles.mark} style={place(drawing.rect, fit.scale)} /> : null}
          {marking ? (
            <div aria-hidden="true" className={styles.markLayer} data-testid="image-mark-layer"
              onPointerCancel={() => setDrawing(undefined)} onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} />
          ) : null}
          {gesture?.guides.map((guide) => (
            <span key={`${guide.axis}-${guide.at}`} aria-hidden="true" className={styles.guide} data-axis={guide.axis}
              style={guide.axis === "x" ? { left: guide.at * fit.scale } : { top: guide.at * fit.scale }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function objectLabel(object: SceneObject): string {
  return object.kind === "text" ? `文字：${object.text.slice(0, 24)}` : `${IMAGE_OBJECT_KIND_LABELS[object.kind]}：${object.id}`;
}
