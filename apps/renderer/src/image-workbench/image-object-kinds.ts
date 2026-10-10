import type { ImageSceneObject } from "@pi67/domain";

/** What each object kind is called wherever the page names one (属性, 图层, the canvas, revision summaries). */
export const IMAGE_OBJECT_KIND_LABELS: Readonly<Record<ImageSceneObject["kind"], string>> = { text: "文字", image: "图片", rect: "矩形", ellipse: "椭圆" };
