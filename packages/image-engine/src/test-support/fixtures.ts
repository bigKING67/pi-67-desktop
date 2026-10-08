// Synthetic local assets for tests only; these are not a real product,
// licensed brand assets, or evidence of an image-model call.
import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Canvas, SceneObject } from "../document.js";

export interface DemoInput { project_id: string; title: string; canvas: Canvas; assets: { id: string; source: string }[]; objects: SceneObject[] }

export async function demoInput(directory: string): Promise<DemoInput> {
  await fs.mkdir(directory);
  const sources: Record<string, string> = {
    background: '<svg width="1000" height="1000" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g"><stop stop-color="#faf7e9"/><stop offset="1" stop-color="#e4e8dc"/></radialGradient></defs><rect width="1000" height="1000" fill="url(#g)"/><circle cx="850" cy="550" r="300" fill="#d2dcca" opacity=".4"/></svg>',
    product: '<svg width="360" height="580" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#576b58"/><stop offset=".35" stop-color="#a1b293"/><stop offset=".72" stop-color="#839c7e"/><stop offset="1" stop-color="#486249"/></linearGradient></defs><ellipse cx="180" cy="562" rx="122" ry="12" fill="#687963" opacity=".16"/><rect x="105" y="20" width="148" height="36" rx="8" fill="#263d30"/><rect x="244" y="20" width="64" height="23" rx="6" fill="#263d30"/><rect x="155" y="52" width="50" height="70" fill="#b8b5a0"/><rect x="100" y="104" width="160" height="48" rx="14" fill="#263d30"/><path d="M100 135 Q65 154 65 205 V525 Q65 554 100 554 H260 Q295 554 295 525 V205 Q295 154 260 135Z" fill="url(#g)"/><rect x="75" y="165" width="16" height="350" rx="8" fill="#d5e0c9" opacity=".25"/><rect x="83" y="276" width="194" height="164" rx="2" fill="#eeeedd"/><path d="M145 316H215 M131 344H229 M151 376H209 M159 399H201" stroke="#4b6350" stroke-width="5"/></svg>',
    logo: '<svg width="180" height="64" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="178" height="62" rx="31" fill="#263d30"/><path d="M35 23H55V41H35Z M73 23H93V41H73Z M111 23H145V41H111Z" fill="#edf0dc"/></svg>'
  };
  const assets: { id: string; source: string }[] = [];
  for (const [assetId, svg] of Object.entries(sources)) {
    const source = path.join(directory, `${assetId}.png`);
    await fs.writeFile(source, await sharp(Buffer.from(svg)).png().toBuffer(), { flag: "wx" });
    assets.push({ id: assetId, source });
  }
  const image = (objectId: string, x: number, y: number, width: number, height: number, fit: "cover" | "contain", locked = false): SceneObject =>
    ({ id: objectId, kind: "image", locked, visible: true, x, y, width, height, opacity: 1, asset_id: objectId, fit });
  const text = (objectId: string, content: string, x: number, y: number, width: number, height: number, size: number, color: string): SceneObject =>
    ({ id: objectId, kind: "text", locked: false, visible: true, x, y, width, height, opacity: 1, text: content, font_size: size, color, align: "left", line_height: 1.25 });
  return { project_id: "spring-poster", title: "图片工程 P0 合成测试海报", canvas: { width: 1000, height: 1000, background: "#e4e8dc" }, assets,
    objects: [
      image("background", 0, 0, 1000, 1000, "cover"),
      image("logo", 710, 64, 180, 64, "contain", true),
      text("eyebrow", "CRAFT LAB / 2026", 70, 74, 600, 32, 22, "#526452"),
      text("headline", "春日焕新\n轻盈日常", 70, 202, 480, 220, 72, "#263d30"),
      text("description", "把清新，留在每一天。", 75, 445, 460, 48, 29, "#526452"),
      text("price", "¥129", 75, 590, 440, 90, 64, "#263d30"),
      text("note", "春日限定 · 300 mL", 78, 708, 460, 40, 24, "#526452"),
      image("product", 580, 254, 340, 548, "contain"),
      text("footer", "本图为工程验收用合成素材，非真实商品广告。", 70, 919, 820, 40, 18, "#526452")
    ] };
}

// Synthetic, local-only candidate inputs and explicit grayscale masks.
export interface CandidateFixtures { backgrounds: string[]; clean: string; edit: { context: { x: number; y: number; width: number; height: number }; generation_mask: string; protection_mask: string; blend_mask: string } }

export async function candidateFixtures(directory: string): Promise<CandidateFixtures> {
  await fs.mkdir(directory);
  const width = 1000, height = 1000;
  const background = (color: string, clutter = true): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><defs><radialGradient id="g"><stop stop-color="#fff9f0"/><stop offset="1" stop-color="${color}"/></radialGradient></defs><rect width="1000" height="1000" fill="url(#g)"/><circle cx="850" cy="550" r="290" fill="#cbaaa0" opacity=".12"/>${clutter ? '<path d="M900 856Q923 817 940 835Q943 853 915 869Z" fill="#788674"/><path d="M916 853Q884 836 888 820Q911 815 923 845Z" fill="#9aab8f"/>' : ""}</svg>`;
  const backgrounds: string[] = [];
  for (const [index, color] of ["#edd9ce", "#d9e3ee", "#e4e4c9"].entries()) {
    const file = path.join(directory, `background-${index + 1}.png`);
    await fs.writeFile(file, await sharp(Buffer.from(background(color))).png().toBuffer(), { flag: "wx" }); backgrounds.push(file);
  }
  const clean = path.join(directory, "clean-background.png");
  await fs.writeFile(clean, await sharp(Buffer.from(background("#edd9ce", false))).png().toBuffer(), { flag: "wx" });
  const generation = Buffer.alloc(width * height), protection = Buffer.alloc(width * height), blend = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x;
    if (x >= 840 && x < 980 && y >= 760 && y < 920) generation[pixel] = 255;
    if ((x >= 580 && x < 920 && y >= 254 && y < 802) || (x >= 710 && x < 890 && y >= 64 && y < 128)) protection[pixel] = 255;
    const distance = Math.hypot(x - 915, y - 845);
    blend[pixel] = Math.round(Math.max(0, Math.min(1, (65 - distance) / 10)) * 255);
    if (!generation[pixel]) blend[pixel] = 0;
  }
  const masks: Record<string, string> = {};
  for (const [key, data] of Object.entries({ generation_mask: generation, protection_mask: protection, blend_mask: blend })) {
    masks[key] = path.join(directory, `${key}.png`);
    await fs.writeFile(masks[key], await sharp(data, { raw: { width, height, channels: 1 } }).toColourspace("b-w").png().toBuffer(), { flag: "wx" });
  }
  return { backgrounds, clean, edit: { context: { x: 820, y: 740, width: 180, height: 180 }, generation_mask: masks.generation_mask ?? "", protection_mask: masks.protection_mask ?? "", blend_mask: masks.blend_mask ?? "" } };
}
