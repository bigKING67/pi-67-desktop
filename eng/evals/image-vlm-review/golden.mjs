// Golden posters for the VLM review eval (docs/plans/2026-10-11-image-vlm-eval.md): engine
// documents rendered with one known defect each, or none, and their labels. Everything is
// synthetic (flat colours and shapes, product words), so no personal data reaches a judge.
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The engine's own sharp, for cropping a wider render back to the poster.
const sharp = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/image-engine/package.json"))("sharp");

/** Every defect the rubric asks about; each poster has at most one. */
export const DEFECTS = ["text_covered", "text_clipped", "wrong_price", "low_contrast", "misaligned", "product_cropped", "seam"];

const WIDTH = 800, HEIGHT = 1000, MARGIN = 64;
/** Defects that need an element past the right edge: drawn on a wider canvas, then cropped to WIDTH. */
const PAST_EDGE = new Set(["text_clipped", "product_cropped"]);
const canvasWidth = (defect) => PAST_EDGE.has(defect) ? WIDTH + 400 : WIDTH;
const THEMES = [
  { id: "cream", background: "#efe6d8", ink: "#2b2622", product: "#8a5a3c", accent: "#b5452f", faint: "#e2d8c8" },
  { id: "mint", background: "#dcebe4", ink: "#18332a", product: "#3f7a62", accent: "#d2643c", faint: "#cfe0d8" },
  { id: "night", background: "#1d2230", ink: "#f2efe8", product: "#c9a46a", accent: "#e0b84c", faint: "#262c3c" },
  { id: "rose", background: "#f3dfe0", ink: "#3a1f24", product: "#9c4b5a", accent: "#4b6fb5", faint: "#ead2d4" },
  { id: "sky", background: "#dfe9f5", ink: "#1b2838", product: "#4a6d96", accent: "#c0532e", faint: "#d3dfee" }
];
const BRIEFS = [
  { headline: "春日茶礼 · 新品", price: "¥199" },
  { headline: "冷萃咖啡 上新", price: "¥39" },
  { headline: "夏季防晒 套装", price: "¥268" }
];

const text = (id, value, x, y, width, height, fontSize, color, extra = {}) =>
  ({ id, kind: "text", locked: false, visible: true, x, y, width, height, opacity: 1, text: value, font_size: fontSize, color, align: "left", line_height: 1.2, ...extra });
const rect = (id, x, y, width, height, color, extra = {}) => ({ id, kind: "rect", locked: false, visible: true, x, y, width, height, opacity: 1, color, radius: 0, ...extra });

/** One poster's document objects: background, product, headline, price, with `defect` applied. */
export function posterObjects(theme, brief, defect) {
  const headline = text("headline", brief.headline, MARGIN, 96, WIDTH - MARGIN * 2, 96, 64, theme.ink);
  const price = text("price", defect === "wrong_price" ? wrongPrice(brief.price) : brief.price, MARGIN, 820, 360, 96, 72, defect === "low_contrast" ? theme.faint : theme.accent);
  // The product: a rounded box with a lid and a label band, moved together when it is cropped.
  const [px, py] = defect === "product_cropped" ? [560, 380] : [260, 300];
  const product = [rect("lid", px + 30, py, 220, 60, shade(theme.product, 30), { radius: 14 }), rect("box", px, py + 40, 280, 380, theme.product, { radius: 28 }),
    rect("band", px, py + 200, 280, 90, shade(theme.product, 45))];
  const objects = [rect("background", 0, 0, canvasWidth(defect), HEIGHT, theme.background)];
  // A seam: the right part of the background a shade off, meeting the rest in a hard vertical edge.
  if (defect === "seam") objects.push(rect("patch", 470, 0, WIDTH - 470, HEIGHT, shade(theme.background, 18)));
  // Clipped: the headline keeps its left edge (so alignment still holds) and runs on past the right one.
  if (defect === "text_clipped") Object.assign(headline, { text: `${brief.headline} · 限时特惠`, width: canvasWidth(defect) - MARGIN * 2 });
  if (defect === "misaligned") Object.assign(price, { x: MARGIN + 46 });
  objects.push(...product, headline, price);
  // Covered: a visible sticker (the product colour) over the lower half of the headline's start.
  if (defect === "text_covered") objects.push(rect("sticker", MARGIN - 8, 136, 300, 64, theme.product, { radius: 10 }));
  return objects;
}

function wrongPrice(price) {
  const digits = price.replace(/\D/gu, "");
  const changed = digits.slice(0, -1) + String((Number(digits.at(-1)) + 1) % 10);
  return price.replace(digits, changed);
}

/** `hex` moved `amount` towards the middle: darker when light, lighter when dark. */
export function shade(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => (value >> shift) & 255);
  const light = channels.reduce((sum, channel) => sum + channel, 0) / 3 > 128;
  return `#${channels.map((channel) => Math.max(0, Math.min(255, light ? channel - amount : channel + amount)).toString(16).padStart(2, "0")).join("")}`;
}

/** The set: every theme with every defect, plus clean posters on each theme and brief. */
export function goldenCases() {
  const cases = [];
  THEMES.forEach((theme, themeIndex) => {
    DEFECTS.forEach((defect, defectIndex) => {
      cases.push({ id: `${theme.id}-${defect}`, theme, brief: BRIEFS[(themeIndex + defectIndex) % BRIEFS.length], defect });
    });
    for (const [index, brief] of BRIEFS.slice(0, 2).entries()) cases.push({ id: `${theme.id}-clean-${index + 1}`, theme, brief, defect: "none" });
  });
  return cases;
}

/**
 * Renders `cases` (all by default) with `engine` (the image engine module) into `directory`, returning the
 * labels: id, brief, defect and the PNG path. Nothing here calls a model.
 */
export async function buildGoldenSet(engine, directory, cases = goldenCases()) {
  await mkdir(directory, { recursive: true });
  const labels = [];
  for (const item of cases) {
    const work = join(directory, item.id), root = join(work, "project");
    await mkdir(work, { recursive: true });
    await engine.createProject(root, { project_id: "poster", title: item.brief.headline, canvas: { width: canvasWidth(item.defect), height: HEIGHT, background: item.theme.background },
      assets: [], objects: posterObjects(item.theme, item.brief, item.defect) });
    const output = join(work, "render");
    await engine.renderProject(root, output);
    const png = join(work, "poster.png");
    await sharp(join(output, "image.png")).extract({ left: 0, top: 0, width: WIDTH, height: HEIGHT }).png().toFile(png);
    labels.push({ id: item.id, brief: item.brief, defect: item.defect, png });
  }
  return labels;
}
