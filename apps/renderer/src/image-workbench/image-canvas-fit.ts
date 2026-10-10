import { useLayoutEffect, useState, type RefObject } from "react";

/** The canvas well's margin around the fitted image, in screen pixels. */
const CANVAS_INSET = 20;

export interface CanvasFit { left: number; top: number; scale: number }

/**
 * Fits a canvas of `size` inside the stage with the well's inset, centred, and
 * follows the stage's size. The canvas and the compare view share it, so switching
 * between them never moves the picture.
 */
export function useCanvasFit(stage: RefObject<HTMLElement | null>, size: { width: number; height: number } | undefined): CanvasFit | undefined {
  const [fit, setFit] = useState<CanvasFit>();
  const width = size?.width, height = size?.height;
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !width || !height) return undefined;
    const measure = () => {
      const room = { width: element.clientWidth - CANVAS_INSET * 2, height: element.clientHeight - CANVAS_INSET * 2 };
      const scale = Math.max(0.01, Math.min(room.width / width, room.height / height));
      setFit({ scale, left: CANVAS_INSET + (room.width - width * scale) / 2, top: CANVAS_INSET + (room.height - height * scale) / 2 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stage, width, height]);
  return fit;
}
