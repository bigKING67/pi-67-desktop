import { useRef, useState, type PointerEvent } from "react";
import { useCanvasFit } from "./image-canvas-fit.js";
import styles from "./ImageCanvas.module.css";

export interface CompareImage { src: string; width: number; height: number }

/**
 * 对比 (product model §7 C): the revision a candidate was made from and the
 * candidate, in one fitted frame split by a divider — `修订 N` left, 候选 right. Both
 * are canvas-size renders of the same canvas, so their pixels line up.
 */
export function ImageCandidateCompare({ before, after, baseRevision }: { before: CompareImage; after: CompareImage; baseRevision: number }) {
  const stage = useRef<HTMLDivElement>(null);
  const fit = useCanvasFit(stage, before);
  const [split, setSplit] = useState(50);
  return (
    <div ref={stage} className={styles.stage} data-testid="image-candidate-compare">
      {fit ? (
        <ImageCompareFrame after={after.src} baseRevision={baseRevision} before={before.src} split={split} onSplit={setSplit}
          frame={{ left: fit.left, top: fit.top, width: before.width * fit.scale, height: before.height * fit.scale }} />
      ) : null}
    </div>
  );
}

/** The split, in percent, under a pointer at `clientX` over a frame starting at `left`. */
export function compareSplitAt(clientX: number, left: number, width: number): number {
  return width > 0 ? Math.round(Math.min(100, Math.max(0, ((clientX - left) / width) * 100)) * 10) / 10 : 50;
}

/**
 * The frame itself. The pointer moves the divider from anywhere on the frame,
 * following the cursor exactly; a range input that takes no pointer carries the
 * keyboard (arrows, Home/End) and the accessible name.
 */
export function ImageCompareFrame({ frame, before, after, baseRevision, split, onSplit }: {
  frame: { left: number; top: number; width: number; height: number };
  baseRevision: number;
  before: string;
  after: string;
  split: number;
  onSplit: (split: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSplit(compareSplitAt(event.clientX, box.left, box.width));
  };
  return (
    <div className={styles.compareFrame} style={frame}
      onPointerCancel={() => setDragging(false)}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); follow(event); }}
      onPointerMove={(event) => { if (dragging) follow(event); }}
      onPointerUp={() => setDragging(false)}>
      <img alt={`修订 ${baseRevision}`} className={styles.compareImage} src={before} />
      <img alt="候选" className={styles.compareImage} src={after} style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
      <span aria-hidden="true" className={styles.compareDivider} style={{ left: `${split}%` }} />
      <span aria-hidden="true" className={styles.compareLabel} data-side="before">修订 {baseRevision}</span>
      <span aria-hidden="true" className={styles.compareLabel} data-side="after">候选</span>
      <input aria-label={`对比分界：左侧修订 ${baseRevision}，右侧候选`} className={styles.compareRange} max={100} min={0} step={1} type="range" value={Math.round(split)}
        onChange={(event) => onSplit(Number(event.currentTarget.value))} />
    </div>
  );
}
