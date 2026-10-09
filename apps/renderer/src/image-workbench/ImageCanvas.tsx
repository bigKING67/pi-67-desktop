import type { ImageDocument, ImageEditOperation, ImageObjectPatch, ImageSceneObject as SceneObject } from "@pi67/domain";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { boundsOf, clampInside, RESIZE_HANDLES, resizeRect, snapMove, type Guide, type Rect, type ResizeHandle } from "./image-canvas-geometry.js";
import styles from "./ImageCanvas.module.css";

const INSET = 20;
/** Snap distance in screen pixels, converted to canvas units by the fit scale. */
const SNAP_PX = 6;

interface Fit { left: number; top: number; scale: number }
type Gesture =
  | { kind: "move"; ids: string[]; startX: number; startY: number; dx: number; dy: number; guides: Guide[] }
  | { kind: "resize"; id: string; handle: ResizeHandle; startX: number; startY: number; rect: Rect; guides: Guide[] };

const rectOf = ({ x, y, width, height }: SceneObject): Rect => ({ x, y, width, height });

/**
 * The fitted canvas: the rendered PNG plus a box per visible object in canvas
 * coordinates. Shift-click builds a selection; unlocked selected objects drag
 * together and the primary one resizes from eight handles, both snapping to the
 * canvas and to other objects (hold ⌘/Ctrl to place freely). Each gesture
 * commits once, when the pointer lifts. Rendering stays the engine's.
 */
export function ImageCanvas({ document, src, alt, selectedIds, editable, onSelect, onEdit }: {
  document: ImageDocument | undefined;
  src: string | undefined;
  alt: string;
  selectedIds: readonly string[];
  editable: boolean;
  onSelect: (objectId: string | undefined, options?: { extend?: boolean }) => void;
  onEdit: (summary: string, operations: ImageEditOperation[]) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>();
  const [gesture, setGesture] = useState<Gesture>();
  const canvas = document?.canvas;

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !canvas) return undefined;
    const measure = () => {
      const width = element.clientWidth - INSET * 2, height = element.clientHeight - INSET * 2;
      const scale = Math.max(0.01, Math.min(width / canvas.width, height / canvas.height));
      setFit({ scale, left: INSET + (width - canvas.width * scale) / 2, top: INSET + (height - canvas.height * scale) / 2 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas]);

  const objects = document?.objects.filter((object) => object.visible) ?? [];
  const movable = (ids: readonly string[]) => objects.filter((object) => ids.includes(object.id) && !object.locked);
  const others = (ids: readonly string[]) => objects.filter((object) => !ids.includes(object.id)).map(rectOf);
  const primary = objects.find((object) => object.id === selectedIds.at(-1));
  const resizable = editable && selectedIds.length === 1 && primary && !primary.locked ? primary : undefined;

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
  const pointerMove = (event: PointerEvent) => {
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
    setGesture(undefined);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, object: SceneObject) => {
    if (event.key === "Escape") { onSelect(undefined); return; }
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
                style={{ ...place(frameOf(object), fit.scale), zIndex: index + 1 }}
                type="button"
                onKeyDown={(event) => keyDown(event, object)}
                onPointerCancel={() => setGesture(undefined)}
                onPointerDown={(event) => pointerDown(event, object)}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
              />
            );
          })}
          {resizable ? (
            <div aria-hidden="true" className={styles.handles} style={place(frameOf(resizable), fit.scale)}>
              {RESIZE_HANDLES.map((handle) => (
                <span key={handle} className={styles.handle} data-handle={handle}
                  onPointerCancel={() => setGesture(undefined)} onPointerDown={(event) => handleDown(event, resizable, handle)}
                  onPointerMove={pointerMove} onPointerUp={pointerUp} />
              ))}
            </div>
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
  if (object.kind === "text") return `文字：${object.text.slice(0, 24)}`;
  return object.kind === "image" ? `图片：${object.id}` : `形状：${object.id}`;
}
