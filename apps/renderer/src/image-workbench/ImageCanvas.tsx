import type { ImageDocument, ImageSceneObject as SceneObject } from "@pi67/domain";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./ImageCanvas.module.css";

const INSET = 20;

interface Fit { left: number; top: number; scale: number }

/**
 * The fitted canvas: the rendered PNG plus a box per visible object in canvas
 * coordinates. Unlocked objects drag and nudge; the move commits once, when the
 * pointer lifts (flow B). Rendering stays the engine's; boxes are only handles.
 */
export function ImageCanvas({ document, src, alt, selectedId, editable, onSelect, onMove }: {
  document: ImageDocument | undefined;
  src: string | undefined;
  alt: string;
  selectedId: string | undefined;
  editable: boolean;
  onSelect: (objectId: string | undefined) => void;
  onMove: (objectId: string, x: number, y: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>();
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; dx: number; dy: number }>();
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
  const move = (object: SceneObject, dx: number, dy: number) => {
    if (!canvas) return;
    const x = Math.round(Math.min(Math.max(object.x + dx, -object.width + 1), canvas.width - 1));
    const y = Math.round(Math.min(Math.max(object.y + dy, -object.height + 1), canvas.height - 1));
    if (x !== object.x || y !== object.y) onMove(object.id, x, y);
  };
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, object: SceneObject) => {
    onSelect(object.id);
    if (!editable || object.locked || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: object.id, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || !fit) return;
    setDrag({ ...drag, dx: (event.clientX - drag.startX) / fit.scale, dy: (event.clientY - drag.startY) / fit.scale });
  };
  const pointerUp = (object: SceneObject) => {
    if (drag?.id === object.id && (Math.abs(drag.dx) >= 1 || Math.abs(drag.dy) >= 1)) move(object, drag.dx, drag.dy);
    setDrag(undefined);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, object: SceneObject) => {
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (event.key === "Escape") { onSelect(undefined); return; }
    if (!delta || !editable || object.locked) return;
    event.preventDefault();
    move(object, delta[0]!, delta[1]!);
  };

  return (
    <div ref={stage} className={styles.stage} onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(undefined); }}>
      {src ? <img alt={alt} className={styles.image} src={src} /> : null}
      {fit && canvas && src ? (
        <div className={styles.overlay} style={{ left: fit.left, top: fit.top, width: canvas.width * fit.scale, height: canvas.height * fit.scale }}>
          {[...objects].reverse().map((object) => {
            const dragging = drag?.id === object.id;
            const left = (object.x + (dragging ? drag.dx : 0)) * fit.scale, top = (object.y + (dragging ? drag.dy : 0)) * fit.scale;
            return (
              <button
                key={object.id}
                aria-label={`${objectLabel(object)}${object.locked ? "（已锁定）" : ""}`}
                aria-pressed={selectedId === object.id}
                className={`${styles.box} ${selectedId === object.id ? styles.selected : ""} ${object.locked ? styles.locked : ""}`}
                data-object-id={object.id}
                style={{ left, top, width: object.width * fit.scale, height: object.height * fit.scale }}
                type="button"
                onKeyDown={(event) => keyDown(event, object)}
                onPointerCancel={() => setDrag(undefined)}
                onPointerDown={(event) => pointerDown(event, object)}
                onPointerMove={pointerMove}
                onPointerUp={() => pointerUp(object)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function objectLabel(object: SceneObject): string {
  if (object.kind === "text") return `文字：${object.text.slice(0, 24)}`;
  return object.kind === "image" ? `图片：${object.id}` : `形状：${object.id}`;
}
