import type { ImageSceneObject } from "@pi67/domain";

/** What each object kind is called wherever the page names one (属性, 图层, the canvas, revision summaries). */
export const IMAGE_OBJECT_KIND_LABELS: Readonly<Record<ImageSceneObject["kind"], string>> = { text: "文字", image: "图片", rect: "矩形", ellipse: "椭圆" };

// The ids the page and its starting points give layers of each kind, in product words.
const DEFAULT_NAMES: Readonly<Partial<Record<ImageSceneObject["kind"], Readonly<Record<string, string>>>>> = {
  image: { photo: "照片", background: "背景", logo: "Logo" },
  rect: { shape: "矩形", background: "背景", badge: "徽标" },
  ellipse: { ellipse: "椭圆" }
};

/**
 * What the page calls a layer: a text layer by its words; another by its id, in product words
 * when it is a default id for its kind (`shape-2` → 矩形 2). Other ids show as they are.
 */
export function imageObjectName(object: ImageSceneObject): string {
  if (object.kind === "text") return object.text;
  const match = /^([a-z]+)(?:-(\d+))?$/u.exec(object.id);
  const base = match ? DEFAULT_NAMES[object.kind]?.[match[1]!] : undefined;
  return base ? (match![2] ? `${base} ${match![2]}` : base) : object.id;
}
