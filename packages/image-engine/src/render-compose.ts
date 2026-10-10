import * as fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";
import { textObjects, type Gradient, type ImageDocument, type SceneObject } from "./document.js";
import { checkTextWidths } from "./font.js";
import { fail } from "./content-store.js";

export interface ComposeInput {
  root: string; font: Buffer; fonts?: ReadonlyMap<string, Buffer>; document: ImageDocument;
  /** Text measurement only: blend and masks are not composited (they never change layout). */
  layoutOnly?: boolean;
}
/** Satori family names for user fonts, kept apart from any name a font file declares. */
const userFamily = (fontId: string): string => `pi67-user-${fontId}`;
export interface TextMeasurement { width: number; height: number }
export interface Composition { svg: string; text_measurements: Record<string, TextMeasurement> }

type SatoriNode = { type: string; props: Record<string, unknown> };
const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;

/**
 * Rotation and flips about the declared box's centre, given explicitly: a text node is
 * laid out at its natural height, so satori's default origin (the node's own centre)
 * would turn the words about a point above the box's middle.
 */
function transformOf(object: SceneObject): { transform?: string; transformOrigin?: string } {
  const parts = [object.rotation ? `rotate(${object.rotation}deg)` : "", object.flip_x ? "scaleX(-1)" : "", object.flip_y ? "scaleY(-1)" : ""].filter(Boolean);
  return parts.length ? { transform: parts.join(" "), transformOrigin: `${object.width / 2}px ${object.height / 2}px` } : {};
}

/**
 * CSS for a gradient fill; offsets are percentages of the box. A radial one is an
 * ellipse of half the box each way, so offset 1 lands on the box's edges (an ellipse's
 * own boundary), not on its corners as the CSS default would. Satori ignores the size
 * keywords (`farthest-side`, `closest-side`), so the radii are given explicitly.
 */
function gradientCss(gradient: Gradient): string {
  const stops = gradient.stops.map((stop) => `${stop.color} ${Math.round(stop.offset * 1000) / 10}%`).join(", ");
  return gradient.type === "linear" ? `linear-gradient(${gradient.angle ?? 90}deg, ${stops})` : `radial-gradient(ellipse 50% 50% at 50% 50%, ${stops})`;
}

export async function compose(project: ComposeInput): Promise<Composition> {
  const { document: doc, root, font } = project, userFonts = project.fonts ?? new Map<string, Buffer>();
  const visible = doc.objects.filter((object) => object.visible);
  const texts = textObjects(visible);
  checkTextWidths(font, texts, userFonts);
  // Encode only rasters that visible objects draw; history keeps every asset bound.
  const images = new Map<string, string>();
  for (const object of visible) {
    if (object.kind !== "image" || images.has(object.asset_id)) continue;
    const asset = doc.assets.find((item) => item.id === object.asset_id);
    if (!asset) throw new Error(`Missing asset for ${object.id}`);
    images.set(asset.id, `data:image/png;base64,${(await fs.readFile(path.join(root, asset.render_file))).toString("base64")}`);
  }
  const measurements = new Map<string, TextMeasurement>();
  const fonts = [
    { name: doc.font.family, data: font, weight: 400 as const, style: "normal" as const },
    ...[...new Set(texts.flatMap((object) => object.font_id ? [object.font_id] : []))].map((fontId) => (
      { name: userFamily(fontId), data: userFonts.get(fontId) ?? fail(`Missing font for ${fontId}`), weight: 400 as const, style: "normal" as const }))
  ];
  const pass = (objects: readonly SceneObject[], background: string | undefined): Promise<string> => satori({ type: "div", props: {
    style: { display: "flex", position: "relative", width: doc.canvas.width, height: doc.canvas.height, ...(background ? { backgroundColor: background } : {}) },
    children: objects.map((object) => nodeOf(object, doc, images)) } } as unknown as Parameters<typeof satori>[0], {
    width: doc.canvas.width, height: doc.canvas.height, embedFont: true, fonts,
    onNodeDetected: (node) => {
      const nodeId = (node.props as { id?: unknown } | undefined)?.id;
      if (typeof nodeId === "string" && nodeId.startsWith("text-")) measurements.set(nodeId.slice(5), { width: node.width, height: node.height });
    }
  });
  // One satori pass unless something blends or is masked; satori drops both, so then each such
  // object becomes its own layer and resvg composites the assembled SVG (P4 spike).
  const layered = !project.layoutOnly && visible.some((object) => object.blend || object.mask);
  const svg = layered ? await assemble(doc, root, visible, pass) : await pass(visible, doc.canvas.background);
  for (const object of texts) {
    const size = measurements.get(object.id);
    if (!size || size.height > object.height + 0.5 || size.width > object.width + 0.5) throw new Error(`Text overflow: ${object.id}`);
  }
  return { svg, text_measurements: Object.fromEntries(measurements) };
}

function nodeOf(object: SceneObject, doc: ImageDocument, images: ReadonlyMap<string, string>): SatoriNode {
  const style = { display: "flex", position: "absolute", left: object.x, top: object.y, width: object.width, height: object.height, opacity: object.opacity, ...transformOf(object) };
  if (object.kind === "image") return { type: "img", props: { src: images.get(object.asset_id), style: { ...style, objectFit: object.fit } } };
  if (object.kind === "rect" || object.kind === "ellipse") {
    const fill = object.gradient ? { backgroundImage: gradientCss(object.gradient) } : { backgroundColor: object.color };
    return { type: "div", props: { style: { ...style, ...fill, borderRadius: object.kind === "ellipse" ? "50%" : object.radius } } };
  }
  // Measure natural text height rather than clipping it into the declared box.
  // Satori outlines only the fonts given to it, so SVG/PNG never use a host font. A user
  // font comes first; characters it lacks fall back to the pinned font, which is always loaded.
  const { height: _height, ...textStyle } = style;
  return { type: "div", props: { id: `text-${object.id}`, style: { ...textStyle, fontFamily: object.font_id ? userFamily(object.font_id) : doc.font.family, fontWeight: 400,
    fontSize: object.font_size, lineHeight: object.line_height, color: object.color, flexDirection: "column" },
    // Explicit lines must remain independent blocks: Satori's break-all
    // wrapping otherwise collapses newlines even with pre-wrap.
    children: object.text.split("\n").map((line) => ({ type: "div", props: { style: { display: "flex", width: object.width,
      minHeight: object.font_size * object.line_height, whiteSpace: "pre-wrap", wordBreak: "break-all", textAlign: object.align,
      justifyContent: JUSTIFY[object.align] }, children: line || " " } })) } };
}

/**
 * Renders runs of objects as separate transparent layers in paint order — consecutive
 * plain objects share one, each blended or masked object is its own — and assembles
 * one SVG over the canvas background. Satori reuses the same ids in every render, so
 * each layer's ids are prefixed before they meet.
 */
async function assemble(doc: ImageDocument, root: string, visible: readonly SceneObject[], pass: (objects: readonly SceneObject[], background: undefined) => Promise<string>): Promise<string> {
  const runs: SceneObject[][] = [];
  for (const object of visible) {
    const alone = Boolean(object.blend || object.mask), last = runs.at(-1);
    if (!alone && last && !last.some((item) => item.blend || item.mask)) last.push(object);
    else runs.push([object]);
  }
  const { width, height, background } = doc.canvas;
  const defs: string[] = [], groups: string[] = [];
  // One read (and negation) per mask image and direction, however many objects use it.
  const maskImages = new Map<string, Promise<string>>();
  for (const [index, run] of runs.entries()) {
    const prefix = `l${index}-`;
    const inner = namespace((await pass(run, undefined)).replace(/^<svg[^>]*>/u, "").replace(/<\/svg>\s*$/u, ""), prefix);
    const object = run.length === 1 ? run[0]! : undefined;
    const attributes: string[] = [];
    if (object?.blend) attributes.push(`style="mix-blend-mode:${object.blend}"`);
    if (object?.mask) {
      defs.push(await maskDef(doc, root, object, `${prefix}mask`, maskImages));
      attributes.push(`mask="url(#${prefix}mask)"`);
    }
    groups.push(`<g${attributes.length ? ` ${attributes.join(" ")}` : ""}>${inner}</g>`);
  }
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
    + `${defs.length ? `<defs>${defs.join("")}</defs>` : ""}<rect width="${width}" height="${height}" fill="${background}"/>${groups.join("")}</svg>`;
}

/** Prefixes every id a layer defines and every reference to one. */
function namespace(svg: string, prefix: string): string {
  return svg.replace(/\bid="([^"]+)"/gu, `id="${prefix}$1"`).replace(/url\(#([^)]+)\)/gu, `url(#${prefix}$1)`).replace(/\b(xlink:href|href)="#([^"]+)"/gu, `$1="#${prefix}$2"`);
}

/**
 * A luminance mask from a project raster over the object's box, turned and flipped like
 * the object. Inverting first lays the image on black, so a transparent area (hidden as
 * it is) is shown once inverted, as the person expects.
 */
async function maskDef(doc: ImageDocument, root: string, object: SceneObject, id: string, cache: Map<string, Promise<string>>): Promise<string> {
  const mask = object.mask!;
  const asset = doc.assets.find((item) => item.id === mask.asset_id) ?? fail(`Missing mask asset for ${object.id}`);
  const key = `${asset.id}${mask.invert ? ":invert" : ""}`;
  let data = cache.get(key);
  if (!data) {
    data = fs.readFile(path.join(root, asset.render_file)).then(async (bytes) =>
      (mask.invert ? await sharp(bytes).flatten({ background: "#000000" }).negate({ alpha: false }).png().toBuffer() : bytes).toString("base64"));
    cache.set(key, data);
  }
  const encoded = await data;
  const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
  const turns = [object.rotation ? `rotate(${object.rotation})` : "", object.flip_x || object.flip_y ? `scale(${object.flip_x ? -1 : 1} ${object.flip_y ? -1 : 1})` : ""].filter(Boolean);
  const transform = turns.length ? ` transform="translate(${cx} ${cy}) ${turns.join(" ")} translate(${-cx} ${-cy})"` : "";
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${doc.canvas.width}" height="${doc.canvas.height}">`
    + `<image href="data:image/png;base64,${encoded}" x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" preserveAspectRatio="none"${transform}/></mask>`;
}
