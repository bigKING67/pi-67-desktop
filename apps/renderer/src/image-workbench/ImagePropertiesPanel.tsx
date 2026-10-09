import type { ImageCanvas, ImageObjectPatch, ImageSceneObject } from "@pi67/domain";
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { ImageAlignToolbar } from "./ImageAlignToolbar.js";
import {
  editImageProject,
  type ImageEditOutcome,
  toggleImageObjectLock,
  toggleImageObjectVisibility,
  useImageProject
} from "./image-project-controller.js";
import styles from "./ImageInspector.module.css";

type FieldKind = "int" | "number" | "color";
interface FieldSpec<K extends string> { key: K; label: string; kind: FieldKind; min?: number; max?: number }

// Ranges follow the engine's document validation, so a value it would refuse never leaves the field.
const COMMON: FieldSpec<keyof ImageObjectPatch>[] = [
  { key: "x", label: "X", kind: "int", min: 0 }, { key: "y", label: "Y", kind: "int", min: 0 },
  { key: "width", label: "宽", kind: "int", min: 1 }, { key: "height", label: "高", kind: "int", min: 1 },
  { key: "opacity", label: "不透明度", kind: "number", min: 0, max: 1 }
];
const BY_KIND: Record<ImageSceneObject["kind"], FieldSpec<keyof ImageObjectPatch>[]> = {
  text: [{ key: "font_size", label: "字号", kind: "int", min: 8, max: 500 }, { key: "line_height", label: "行高", kind: "number", min: 1, max: 2 }, { key: "color", label: "颜色", kind: "color" }],
  rect: [{ key: "color", label: "颜色", kind: "color" }, { key: "radius", label: "圆角", kind: "int", min: 0 }],
  image: []
};
const CANVAS: FieldSpec<keyof ImageCanvas>[] = [
  { key: "width", label: "宽", kind: "int", min: 64, max: 8192 }, { key: "height", label: "高", kind: "int", min: 64, max: 8192 },
  { key: "background", label: "背景", kind: "color" }
];
const COLOR = /^#[0-9a-fA-F]{6}$/u;
const KIND_LABELS = { text: "文字", image: "图片", rect: "形状" } as const;

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
        <p className={styles.sectionLabel}>{KIND_LABELS[object.kind]} · {object.id}</p>
        <Button aria-label={object.visible ? "隐藏" : "显示"} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectVisibility(object)}>
          {object.visible ? <Eye aria-hidden="true" size={13} /> : <EyeOff aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={object.locked ? "解锁" : "锁定"} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectLock(object)}>
          {object.locked ? <Lock aria-hidden="true" size={13} /> : <LockOpen aria-hidden="true" size={13} />}
        </Button>
      </div>
      {object.locked ? <p className={styles.empty}>已锁定。解锁后才能修改。</p> : null}
      <div className={styles.fieldGrid}>
        {[...COMMON, ...BY_KIND[object.kind]].map((spec) => (
          <PropertyField key={`${object.id}-${spec.key}`} disabled={object.locked || busy} spec={spec} value={(object as unknown as Record<string, unknown>)[spec.key]}
            onCommit={async (value) => { const result = await editImageProject(`修改${spec.label}`, [{ type: "update_object", id: object.id, patch: { [spec.key]: value } as ImageObjectPatch }]); report(result); return result; }} />
        ))}
      </div>
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
      {status}
      {object.locked ? null : <ImageAlignToolbar busy={busy} canvas={document.canvas} objects={selected} />}
    </div>
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
