import * as fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import { textObjects, type ImageDocument } from "./document.js";
import { checkTextWidths } from "./font.js";

export interface ComposeInput { root: string; font: Buffer; document: ImageDocument }
export interface TextMeasurement { width: number; height: number }
export interface Composition { svg: string; text_measurements: Record<string, TextMeasurement> }

type SatoriNode = { type: string; props: Record<string, unknown> };
const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;

export async function compose(project: ComposeInput): Promise<Composition> {
  const { document: doc, root, font } = project;
  checkTextWidths(font, textObjects(doc.objects).filter((object) => object.visible));
  // Encode only rasters that visible objects draw; history keeps every asset bound.
  const images = new Map<string, string>();
  for (const object of doc.objects) {
    if (!object.visible || object.kind !== "image" || images.has(object.asset_id)) continue;
    const asset = doc.assets.find((item) => item.id === object.asset_id);
    if (!asset) throw new Error(`Missing asset for ${object.id}`);
    images.set(asset.id, `data:image/png;base64,${(await fs.readFile(path.join(root, asset.render_file))).toString("base64")}`);
  }
  const measurements = new Map<string, TextMeasurement>();
  const children: SatoriNode[] = doc.objects.filter((object) => object.visible).map((object) => {
    const style = { display: "flex", position: "absolute", left: object.x, top: object.y, width: object.width, height: object.height, opacity: object.opacity };
    if (object.kind === "image") return { type: "img", props: { src: images.get(object.asset_id), style: { ...style, objectFit: object.fit } } };
    if (object.kind === "rect") return { type: "div", props: { style: { ...style, backgroundColor: object.color, borderRadius: object.radius } } };
    // Measure natural text height rather than clipping it into the declared box.
    // Satori outlines the bound font, so SVG/PNG never use a host font fallback.
    const { height: _height, ...textStyle } = style;
    return { type: "div", props: { id: `text-${object.id}`, style: { ...textStyle, fontFamily: doc.font.family, fontWeight: 400,
      fontSize: object.font_size, lineHeight: object.line_height, color: object.color, flexDirection: "column" },
      // Explicit lines must remain independent blocks: Satori's break-all
      // wrapping otherwise collapses newlines even with pre-wrap.
      children: object.text.split("\n").map((line) => ({ type: "div", props: { style: { display: "flex", width: object.width,
        minHeight: object.font_size * object.line_height, whiteSpace: "pre-wrap", wordBreak: "break-all", textAlign: object.align,
        justifyContent: JUSTIFY[object.align] }, children: line || " " } })) } };
  });
  const rootNode: SatoriNode = { type: "div", props: { style: { display: "flex", position: "relative", width: doc.canvas.width, height: doc.canvas.height, backgroundColor: doc.canvas.background }, children } };
  const svg = await satori(rootNode as unknown as Parameters<typeof satori>[0], {
    width: doc.canvas.width, height: doc.canvas.height,
    embedFont: true, fonts: [{ name: doc.font.family, data: font, weight: 400, style: "normal" }],
    onNodeDetected: (node) => {
      const nodeId = (node.props as { id?: unknown } | undefined)?.id;
      if (typeof nodeId === "string" && nodeId.startsWith("text-")) measurements.set(nodeId.slice(5), { width: node.width, height: node.height });
    }
  });
  for (const object of textObjects(doc.objects).filter((object) => object.visible)) {
    const size = measurements.get(object.id);
    if (!size || size.height > object.height + 0.5 || size.width > object.width + 0.5) throw new Error(`Text overflow: ${object.id}`);
  }
  return { svg, text_measurements: Object.fromEntries(measurements) };
}
