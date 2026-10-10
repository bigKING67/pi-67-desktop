import { IMAGE_PROMPT_CONTEXT_LIMITS, type ImageDocument, type ImageMark, type ImageReferenceRole } from "@pi67/domain";
import { useImageProject, type ImageProjectState } from "./image-project-controller.js";

// Marks and references are the person's notes for the next message (product
// model §6): regions with an instruction each, and project images offered as
// references with one role. They live in the page, never in the project, and
// marks retire once a message carrying them is accepted.

const MIN_MARK_EDGE = 8;

/**
 * Adds a region in canvas pixels, clipped to the canvas (a framed object may bleed
 * past it), and returns its id (`m1`, `m2`, …); undefined at the limit or for a stray click.
 */
export function addImageMark(area: { x: number; y: number; width: number; height: number }): string | undefined {
  const { marks, document } = useImageProject.getState();
  const canvas = document?.canvas ?? { width: Infinity, height: Infinity };
  const left = Math.max(0, area.x), top = Math.max(0, area.y);
  const rect = { x: left, y: top, width: Math.min(canvas.width, area.x + area.width) - left, height: Math.min(canvas.height, area.y + area.height) - top };
  if (marks.length >= IMAGE_PROMPT_CONTEXT_LIMITS.marks || rect.width < MIN_MARK_EDGE || rect.height < MIN_MARK_EDGE) return undefined;
  const used = new Set(marks.map((mark) => mark.id));
  let index = 1;
  while (used.has(`m${index}`)) index += 1;
  // Rounding the edges, not the size, keeps a region drawn to the canvas edge on it.
  const x = Math.round(rect.x), y = Math.round(rect.y);
  const mark: ImageMark = { id: `m${index}`, x, y, width: Math.round(rect.x + rect.width) - x, height: Math.round(rect.y + rect.height) - y, instruction: "" };
  useImageProject.setState({ marks: [...marks, mark] });
  return mark.id;
}

export function setImageMarkInstruction(id: string, instruction: string): void {
  useImageProject.setState((state) => ({ marks: state.marks.map((mark) => mark.id === id ? { ...mark, instruction: instruction.slice(0, IMAGE_PROMPT_CONTEXT_LIMITS.instruction) } : mark) }));
}

export function removeImageMark(id: string): void {
  useImageProject.setState((state) => ({ marks: state.marks.filter((mark) => mark.id !== id) }));
}

/** Marks with words are sent; an empty one is only a box and stays out of the message. */
export function sendableImageMarks(marks: readonly ImageMark[]): ImageMark[] {
  return marks.filter((mark) => mark.instruction.trim().length > 0);
}

/** Detaches the marks from the next message (or attaches them again) without deleting them. */
export function holdImageMarks(held: boolean): void {
  useImageProject.setState({ marksHeld: held });
}

/** The accepted message carried exactly these marks; drop them, keep any added or reworded since. */
export function retireImageMarks(sent: readonly ImageMark[]): void {
  useImageProject.setState((state) => ({ marks: state.marks.filter((mark) => !sent.includes(mark)) }));
}

/** Gives an image layer one reference role, or removes it with `undefined`; at most two references. */
export function setImageReference(objectId: string, role: ImageReferenceRole | undefined): void {
  useImageProject.setState((state) => {
    const others = state.references.filter((reference) => reference.objectId !== objectId);
    if (role === undefined) return { references: others };
    if (others.length >= IMAGE_PROMPT_CONTEXT_LIMITS.references) return {};
    return { references: [...others, { objectId, role }] };
  });
}

/** References as sent: each layer's current asset, so an accepted candidate is what goes. */
export function resolveImageReferences(document: ImageDocument | undefined, references: ImageProjectState["references"]): { assetId: string; role: ImageReferenceRole }[] {
  return references.flatMap((reference) => {
    const object = document?.objects.find((item) => item.id === reference.objectId);
    return object?.kind === "image" ? [{ assetId: object.asset_id, role: reference.role }] : [];
  });
}
