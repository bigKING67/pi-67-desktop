import { Type } from "typebox";
import { IMAGE_ID_PATTERN } from "./image-workbench-job.js";

// The operations `image_project_edit` accepts, mirroring the engine's exact field
// checks (project.ts OPERATION_FIELDS, document.ts validateAsset). Without this
// schema a real model guessed six operation shapes before one worked; with it a
// malformed operation fails validation before any approval is asked.

const id = (description: string) => Type.String({ pattern: IMAGE_ID_PATTERN, description });
const color = Type.String({ pattern: "^#[0-9a-fA-F]{6}$", description: "#RRGGBB" });
const int = (minimum?: number) => Type.Integer(minimum === undefined ? {} : { minimum });
const align = Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")]);
const box = { x: int(0), y: int(0), width: int(1), height: int(1) };
const rotation = Type.Number({ minimum: -180, maximum: 180, description: "Degrees clockwise about the box centre; the unrotated box must stay on the canvas." });
const common = { id: id("New object id."), locked: Type.Boolean(), visible: Type.Boolean(), ...box, opacity: Type.Number({ minimum: 0, maximum: 1 }),
  rotation: Type.Optional(rotation), flip_x: Type.Optional(Type.Literal(true)), flip_y: Type.Optional(Type.Literal(true)) };
const text = { text: Type.String({ maxLength: 2000 }), font_size: Type.Integer({ minimum: 8, maximum: 500 }), color, align, line_height: Type.Number({ minimum: 1, maximum: 2 }) };

// Fonts are added by the person only (add_font is not an Agent operation); text may use a bound one.
const fontId = Type.Union([id("A font id from image_project_read fonts."), Type.Null()], { description: "A bound user font id, or null for the built-in font." });
const patch = Type.Partial(Type.Object({
  ...box, opacity: common.opacity, visible: Type.Boolean(), locked: Type.Boolean(), ...text, font_id: fontId,
  rotation: Type.Union([rotation, Type.Null()], { description: "Degrees clockwise; null or 0 removes it." }),
  flip_x: Type.Union([Type.Boolean(), Type.Null()], { description: "Mirror left-right; false or null removes it." }),
  flip_y: Type.Union([Type.Boolean(), Type.Null()], { description: "Mirror top-bottom; false or null removes it." }),
  radius: int(0), fit: Type.Union([Type.Literal("contain"), Type.Literal("cover"), Type.Literal("fill")])
}, { additionalProperties: false }), { additionalProperties: false, minProperties: 1,
  description: "Only the fields to change. A lock change ({locked}) must be the only field and the only operation in its batch." });

export const IMAGE_EDIT_OPERATION = Type.Union([
  Type.Object({ type: Type.Literal("update_object"), id: id("Existing object id."), patch }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("add_object"), object: Type.Union([
    Type.Object({ ...common, kind: Type.Literal("text"), ...text, font_id: Type.Optional(id("A font id from image_project_read fonts.")) }, { additionalProperties: false }),
    Type.Object({ ...common, kind: Type.Literal("rect"), color, radius: int(0) }, { additionalProperties: false })
  ]) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("add_asset"), asset: Type.Object({ id: id("New asset id."), source: Type.String({ minLength: 1, maxLength: 4096, description: "Local PNG/JPEG/WebP path, absolute or relative to the Workspace." }) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("remove_object"), id: id("Existing unlocked object id.") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("reorder_objects"), ids: Type.Array(id("Object id."), { minItems: 1, description: "Every object id once, bottom to top." }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("set_canvas"), canvas: Type.Object({ width: Type.Integer({ minimum: 64, maximum: 8192 }), height: Type.Integer({ minimum: 64, maximum: 8192 }), background: color }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("revert_to"), revision: Type.Integer({ minimum: 1, description: "Must be the only operation in its batch." }) }, { additionalProperties: false })
]);

type Operation = Record<string, unknown>;

/** Local `add_asset` sources, for path safety and Workspace-relative resolution. */
export function editAssetSources(operations: unknown): string[] {
  if (!Array.isArray(operations)) return [];
  return operations.flatMap((op: Operation) => op?.type === "add_asset" && typeof (op.asset as Operation | undefined)?.source === "string" ? [(op.asset as Operation).source as string] : []);
}

/** The batch with each `add_asset` source resolved by `resolve` (against the session's Workspace). */
export function resolveEditAssetSources(operations: unknown, resolve: (source: string) => string): unknown {
  if (!Array.isArray(operations)) return operations;
  return operations.map((op: Operation) => op?.type === "add_asset" && typeof (op.asset as Operation | undefined)?.source === "string"
    ? { ...op, asset: { ...(op.asset as Operation), source: resolve((op.asset as Operation).source as string) } } : op);
}
