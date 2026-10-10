import { IMAGE_PROMPT_CONTEXT_LIMITS, IMAGE_REFERENCE_ROLE_LABELS, IMAGE_REFERENCE_ROLES, IMAGE_USER_FONT_LIMIT, type ImageCanvas, type ImageEllipseObject, type ImageGradient, type ImageObjectPatch, type ImageRectObject, type ImageSceneObject, type ImageTextObject, type ImageUserFont } from "@pi67/domain";
import { Eye, EyeOff, Lock, LockOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { ImageAlignToolbar } from "./ImageAlignToolbar.js";
import { IMAGE_OBJECT_KIND_LABELS } from "./image-object-kinds.js";
import { SettingsSelect } from "../settings/SettingsPrimitives.js";
import {
  addImageFont,
  editImageProject,
  type ImageEditOutcome,
  toggleImageObjectLock,
  toggleImageObjectVisibility,
  useImageProject
} from "./image-project-controller.js";
import { setImageReference } from "./image-project-marks.js";
import styles from "./ImageInspector.module.css";

type FieldKind = "int" | "number" | "color";
interface FieldSpec<K extends string> { key: K; label: string; kind: FieldKind; min?: number; max?: number; /** Shown while the field is absent. */ fallback?: number }

// Ranges follow the engine's document validation, so a value it would refuse never leaves the field.
const COMMON: FieldSpec<keyof ImageObjectPatch>[] = [
  { key: "x", label: "X", kind: "int", min: 0 }, { key: "y", label: "Y", kind: "int", min: 0 },
  { key: "width", label: "宽", kind: "int", min: 1 }, { key: "height", label: "高", kind: "int", min: 1 },
  { key: "opacity", label: "不透明度", kind: "number", min: 0, max: 1 },
  { key: "rotation", label: "旋转 °", kind: "number", min: -180, max: 180, fallback: 0 }
];
const BY_KIND: Record<ImageSceneObject["kind"], FieldSpec<keyof ImageObjectPatch>[]> = {
  text: [{ key: "font_size", label: "字号", kind: "int", min: 8, max: 500 }, { key: "line_height", label: "行高", kind: "number", min: 1, max: 2 }, { key: "color", label: "颜色", kind: "color" }],
  rect: [{ key: "color", label: "颜色", kind: "color" }, { key: "radius", label: "圆角", kind: "int", min: 0 }],
  ellipse: [{ key: "color", label: "颜色", kind: "color" }],
  image: []
};
const CANVAS: FieldSpec<keyof ImageCanvas>[] = [
  { key: "width", label: "宽", kind: "int", min: 64, max: 8192 }, { key: "height", label: "高", kind: "int", min: 64, max: 8192 },
  { key: "background", label: "背景", kind: "color" }
];
const COLOR = /^#[0-9a-fA-F]{6}$/u;
const FLIPS = { flip_x: "水平翻转", flip_y: "垂直翻转" } as const;


/** 属性: the canvas, one object's fields, or alignment for several. Each change is one revision. */
export function ImagePropertiesPanel() {
  const document = useImageProject((state) => state.document);
  const selectedIds = useImageProject((state) => state.selectedObjectIds);
  const busy = useImageProject((state) => state.busy);
  const [notice, setNotice] = useState<string>();
  useEffect(() => setNotice(undefined), [selectedIds]);
  if (!document) return null;
  const selected = selectedIds.flatMap((id) => document.objects.find((object) => object.id === id) ?? []);
  const object = selected.length === 1 ? selected[0] : undefined;
  const report = (result: ImageEditOutcome) => setNotice(result.outcome === "refused" ? result.message : result.outcome === "conflict" ? "项目刚被更新，已刷新到最新修订。" : undefined);
  const status = notice ? <p className={styles.notice} role="status">{notice}</p> : null;

  if (selected.length === 0) {
    const canvas = document.canvas;
    return (
      <div className={styles.properties}>
        <p className={styles.sectionLabel}>画布</p>
        <div className={styles.fieldGrid}>
          {CANVAS.map((spec) => (
            <PropertyField key={spec.key} disabled={busy} spec={spec} value={canvas[spec.key]}
              onCommit={async (value) => { const result = await editImageProject(`修改画布${spec.label}`, [{ type: "set_canvas", canvas: { ...canvas, [spec.key]: value } }]); report(result); return result; }} />
          ))}
        </div>
        {status}
        <p className={styles.empty}>在画布或图层里选中对象查看它的属性；按住 Shift 可以多选并对齐。</p>
      </div>
    );
  }
  if (!object) {
    return (
      <div className={styles.properties}>
        <p className={styles.sectionLabel}>已选 {selected.length} 个对象</p>
        <ImageAlignToolbar busy={busy} canvas={document.canvas} objects={selected} />
        {status}
      </div>
    );
  }
  return (
    <div className={styles.properties}>
      <div className={styles.objectHead}>
        <p className={styles.sectionLabel}>{IMAGE_OBJECT_KIND_LABELS[object.kind]} · {object.id}</p>
        <Button aria-label={object.visible ? "隐藏" : "显示"} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectVisibility(object)}>
          {object.visible ? <Eye aria-hidden="true" size={13} /> : <EyeOff aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={object.locked ? "解锁" : "锁定"} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectLock(object)}>
          {object.locked ? <Lock aria-hidden="true" size={13} /> : <LockOpen aria-hidden="true" size={13} />}
        </Button>
      </div>
      {object.locked ? <p className={styles.empty}>已锁定。解锁后才能修改。</p> : null}
      <div className={styles.fieldGrid}>
        {/* Under a gradient the solid 颜色 is not drawn, so it is not offered. */}
        {[...COMMON, ...BY_KIND[object.kind].filter((spec) => !(spec.key === "color" && "gradient" in object && object.gradient))].map((spec) => (
          <PropertyField key={`${object.id}-${spec.key}`} disabled={object.locked || busy} spec={spec} value={(object as unknown as Record<string, unknown>)[spec.key] ?? spec.fallback}
            onCommit={async (value) => { const result = await editImageProject(`修改${spec.label}`, [{ type: "update_object", id: object.id, patch: { [spec.key]: value } as ImageObjectPatch }]); report(result); return result; }} />
        ))}
      </div>
      <div className={`${styles.alignRow} ${styles.flipRow}`} role="group" aria-label="翻转">
        {(Object.entries(FLIPS) as [keyof typeof FLIPS, string][]).map(([key, label]) => (
          <Button key={key} aria-pressed={object[key] === true} className={`${styles.segment} ${object[key] ? styles.segmentSelected : ""}`}
            isDisabled={object.locked || busy} onPress={() => void editImageProject(label, [{ type: "update_object", id: object.id, patch: { [key]: object[key] ? null : true } }]).then(report)}>
            {label}
          </Button>
        ))}
      </div>
      {object.kind === "text" ? <FontChoice busy={busy} fonts={document.fonts ?? []} object={object} onResult={report} /> : null}
      {object.kind === "text" ? (
        <div className={styles.alignRow} role="group" aria-label="文字对齐">
          {(["left", "center", "right"] as const).map((align) => (
            <Button key={align} aria-pressed={object.align === align} className={`${styles.segment} ${object.align === align ? styles.segmentSelected : ""}`}
              isDisabled={object.locked || busy} onPress={() => void editImageProject("文字对齐", [{ type: "update_object", id: object.id, patch: { align } }]).then(report)}>
              {{ left: "左", center: "中", right: "右" }[align]}
            </Button>
          ))}
        </div>
      ) : null}
      {object.kind === "image" ? <ReferenceRole objectId={object.id} /> : null}
      {object.kind === "rect" || object.kind === "ellipse" ? <FillChoice busy={busy} object={object} onResult={report} /> : null}
      {status}
      {object.locked ? null : <ImageAlignToolbar busy={busy} canvas={document.canvas} objects={selected} />}
    </div>
  );
}

type Fill = "solid" | ImageGradient["type"];
const FILLS: readonly { fill: Fill; label: string }[] = [{ fill: "solid", label: "纯色" }, { fill: "linear", label: "线性渐变" }, { fill: "radial", label: "径向渐变" }];

/**
 * 填充 for rectangles and ellipses: the solid 颜色 above, or a two-colour linear
 * (with an angle) or radial gradient starting from it. A gradient of more stops
 * (only the Agent writes those) is shown, not edited, until switched back.
 */
function FillChoice({ object, busy, onResult }: { object: ImageRectObject | ImageEllipseObject; busy: boolean; onResult: (result: ImageEditOutcome) => void }) {
  const gradient = object.gradient, current: Fill = gradient?.type ?? "solid", disabled = busy || object.locked;
  const write = (summary: string, next: ImageGradient | null) => editImageProject(summary, [{ type: "update_object", id: object.id, patch: { gradient: next } }]).then((result) => { onResult(result); return result; });
  const editable = gradient !== undefined && gradient.stops.length === 2;
  const angle = gradient?.type === "linear" ? gradient.angle ?? 90 : 90;
  const choose = (fill: Fill) => {
    // Choosing a gradient again also turns an Agent's many-stop gradient into an editable two-colour one.
    if (fill === current && (fill === "solid" || editable)) return;
    if (fill === "solid") { void write("改为纯色", null); return; }
    const stops = gradient ? [{ ...gradient.stops[0]!, offset: 0 }, { ...gradient.stops.at(-1)!, offset: 1 }] : [{ offset: 0, color: object.color }, { offset: 1, color: "#ffffff" }];
    void write(fill === "linear" ? "改为线性渐变" : "改为径向渐变", fill === "linear" ? { type: "linear", angle, stops } : { type: "radial", stops });
  };
  const stop = (index: 0 | 1): FieldSpec<"start" | "end"> => ({ key: index === 0 ? "start" : "end", label: index === 0 ? "起点颜色" : "终点颜色", kind: "color" });
  return (
    <div className={styles.fontRow}>
      <p className={styles.sectionLabel}>填充</p>
      <div aria-label="填充" className={styles.alignRow} role="group">
        {FILLS.map(({ fill, label }) => (
          <Button key={fill} aria-pressed={current === fill} className={`${styles.segment} ${current === fill ? styles.segmentSelected : ""}`} isDisabled={disabled} onPress={() => choose(fill)}>{label}</Button>
        ))}
      </div>
      {gradient && editable ? (
        <div className={styles.fieldGrid}>
          {([0, 1] as const).map((index) => (
            <PropertyField key={`${object.id}-stop-${index}`} disabled={disabled} spec={stop(index)} value={gradient.stops[index]!.color}
              onCommit={(color) => write("修改渐变颜色", { ...gradient, stops: gradient.stops.map((item, at) => at === index ? { ...item, color: String(color) } : item) })} />
          ))}
          {gradient.type === "linear" ? (
            <PropertyField key={`${object.id}-angle`} disabled={disabled} spec={{ key: "angle", label: "角度 °", kind: "int", min: 0, max: 360 }} value={angle}
              onCommit={(next) => write("修改渐变角度", { type: "linear", stops: gradient.stops, angle: Number(next) })} />
          ) : null}
        </div>
      ) : gradient ? <p className={styles.empty}>{gradient.stops.length} 色渐变，由 Agent 设置；再点一次渐变类型会改成首尾两色，之后可以在这里编辑。</p> : null}
    </div>
  );
}

const BUILT_IN = "built-in";

/**
 * 字体 for text: the built-in Noto Sans CJK SC or a font added to the project.
 * Characters a user font lacks fall back to the built-in one, which the hint says.
 */
function FontChoice({ object, fonts, busy, onResult }: { object: ImageTextObject; fonts: readonly ImageUserFont[]; busy: boolean; onResult: (result: ImageEditOutcome) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const current = object.font_id ?? BUILT_IN;
  return (
    <div className={styles.fontRow}>
      <p className={styles.sectionLabel}>字体</p>
      <SettingsSelect className={styles.fontSelect ?? ""} isDisabled={busy || object.locked} label="字体" value={current}
        options={[{ id: BUILT_IN, label: "Noto Sans CJK SC", detail: "内置" }, ...fonts.map((font) => ({ id: font.id, label: font.family, detail: font.format.toUpperCase() }))]}
        onChange={(value) => { if (value !== current) void editImageProject("更换字体", [{ type: "update_object", id: object.id, patch: { font_id: value === BUILT_IN ? null : value } }]).then(onResult); }} />
      <Button className={styles.historyAction!} isDisabled={busy || object.locked || fonts.length >= IMAGE_USER_FONT_LIMIT} onPress={() => input.current?.click()}>
        <Plus aria-hidden="true" size={12} />添加字体…
      </Button>
      <input ref={input} accept=".ttf,.otf,font/ttf,font/otf" className={styles.fileInput} tabIndex={-1} type="file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addImageFont(file, object.id); }} />
      <p className={styles.empty}>{fonts.length >= IMAGE_USER_FONT_LIMIT ? `一个项目最多 ${IMAGE_USER_FONT_LIMIT} 个字体。` : ""}添加的 TTF / OTF 只保存在这个项目里，请确认你有使用它的授权；字体里没有的字（比如英文字体里的中文）用内置字体显示。</p>
    </div>
  );
}

/** An image's reference role for the next message (product model §7 E); a page note, not a revision. */
function ReferenceRole({ objectId }: { objectId: string }) {
  const references = useImageProject((state) => state.references);
  const role = references.find((reference) => reference.objectId === objectId)?.role;
  const full = role === undefined && references.length >= IMAGE_PROMPT_CONTEXT_LIMITS.references;
  return (
    <>
      <p className={styles.sectionLabel}>作为参考</p>
      <div aria-label="作为参考" className={`${styles.alignRow} ${styles.roleRow}`} role="group">
        {[undefined, ...IMAGE_REFERENCE_ROLES].map((option) => (
          <Button key={option ?? "none"} aria-pressed={role === option} className={`${styles.segment} ${role === option ? styles.segmentSelected : ""}`}
            isDisabled={full && option !== undefined} onPress={() => setImageReference(objectId, option)}>
            {option ? IMAGE_REFERENCE_ROLE_LABELS[option] : "不用"}
          </Button>
        ))}
      </div>
      <p className={styles.empty}>{full ? `最多 ${IMAGE_PROMPT_CONTEXT_LIMITS.references} 张参考。` : ""}设为参考的图片随下一条消息交给 Agent；正在改的那张图说清要保留什么即可。</p>
    </>
  );
}

function PropertyField<K extends string>({ spec, value, disabled, onCommit }: {
  spec: FieldSpec<K>; value: unknown; disabled: boolean; onCommit: (value: string | number) => Promise<ImageEditOutcome>;
}) {
  const shown = typeof value === "number" ? String(spec.kind === "number" ? Number(value.toFixed(2)) : value) : typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(shown); setInvalid(false); }, [shown]);

  const commit = async () => {
    if (draft === shown) return;
    const next = spec.kind === "color" ? draft.trim() : Number(draft);
    const valid = typeof next === "string" ? COLOR.test(next)
      : Number.isFinite(next) && (spec.kind !== "int" || Number.isInteger(next)) && (spec.min === undefined || next >= spec.min) && (spec.max === undefined || next <= spec.max);
    if (!valid) { setInvalid(true); return; }
    // The same number written differently ("15.0", or an emptied field already at 0) is not an edit.
    if (typeof next === "number" && next === Number(shown || 0)) { setDraft(shown); return; }
    const result = await onCommit(next);
    setInvalid(result.outcome === "refused");
  };
  return (
    <TextField className={styles.field!} isDisabled={disabled} isInvalid={invalid} value={draft} onChange={setDraft}
      onBlur={() => void commit()} onKeyDown={(event) => { if (event.key === "Enter") void commit(); if (event.key === "Escape") { setDraft(shown); setInvalid(false); } }}>
      <Label>{spec.label}</Label>
      <Input inputMode={spec.kind === "color" ? "text" : "decimal"} />
    </TextField>
  );
}
