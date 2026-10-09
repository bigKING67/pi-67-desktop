import type { ImageObjectPatch, ImageSceneObject } from "@pi67/domain";
import { useEffect, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { editImageProject, useImageProject } from "./image-project-controller.js";
import styles from "./ImageInspector.module.css";

type FieldKind = "int" | "number" | "color" | "text";
interface FieldSpec { key: keyof ImageObjectPatch; label: string; kind: FieldKind; min?: number; max?: number }

const COMMON: FieldSpec[] = [
  { key: "x", label: "X", kind: "int" }, { key: "y", label: "Y", kind: "int" },
  { key: "width", label: "宽", kind: "int", min: 1 }, { key: "height", label: "高", kind: "int", min: 1 },
  { key: "opacity", label: "不透明度", kind: "number", min: 0, max: 1 }
];
const BY_KIND: Record<ImageSceneObject["kind"], FieldSpec[]> = {
  text: [{ key: "font_size", label: "字号", kind: "int", min: 1 }, { key: "line_height", label: "行高", kind: "number", min: 0.5, max: 4 }, { key: "color", label: "颜色", kind: "color" }],
  rect: [{ key: "color", label: "颜色", kind: "color" }, { key: "radius", label: "圆角", kind: "int", min: 0 }],
  image: []
};
const COLOR = /^#[0-9a-fA-F]{6}$/u;

/** 属性: the selected object's fields; each change is one revision, refused values never leave the field. */
export function ImagePropertiesPanel() {
  const document = useImageProject((state) => state.document);
  const selectedId = useImageProject((state) => state.selectedObjectId);
  const object = document?.objects.find((item) => item.id === selectedId);
  if (!document) return null;
  if (!object) {
    return (
      <div className={styles.properties}>
        <p className={styles.sectionLabel}>画布</p>
        <p className={styles.readout}>{document.canvas.width} × {document.canvas.height} · 背景 {document.canvas.background}</p>
        <p className={styles.empty}>在画布或图层里选中一个对象，查看并修改它的属性。</p>
      </div>
    );
  }
  return (
    <div className={styles.properties}>
      <p className={styles.sectionLabel}>{object.kind === "text" ? "文字" : object.kind === "image" ? "图片" : "形状"} · {object.id}</p>
      {object.locked ? <p className={styles.empty}>已锁定。在图层里解锁后才能修改。</p> : null}
      <div className={styles.fieldGrid}>
        {[...COMMON, ...BY_KIND[object.kind]].map((spec) => (
          <PropertyField key={`${object.id}-${String(spec.key)}`} disabled={object.locked} object={object} spec={spec} />
        ))}
      </div>
      {object.kind === "text" ? (
        <div className={styles.alignRow} role="group" aria-label="对齐">
          {(["left", "center", "right"] as const).map((align) => (
            <Button key={align} aria-pressed={object.align === align} className={`${styles.segment} ${object.align === align ? styles.segmentSelected : ""}`}
              isDisabled={object.locked} onPress={() => void editImageProject("文字对齐", [{ type: "update_object", id: object.id, patch: { align } }])}>
              {{ left: "左", center: "中", right: "右" }[align]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PropertyField({ object, spec, disabled }: { object: ImageSceneObject; spec: FieldSpec; disabled: boolean }) {
  const current = (object as unknown as Record<string, unknown>)[spec.key as string];
  const shown = typeof current === "number" ? String(spec.kind === "number" ? Number(current.toFixed(2)) : current) : typeof current === "string" ? current : "";
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(shown); setInvalid(false); }, [shown]);

  const commit = async () => {
    if (draft === shown) return;
    const value = spec.kind === "color" || spec.kind === "text" ? draft.trim() : Number(draft);
    const valid = spec.kind === "color" ? COLOR.test(String(value))
      : spec.kind === "text" ? String(value).length > 0
        : Number.isFinite(value) && (spec.kind !== "int" || Number.isInteger(value)) && (spec.min === undefined || (value as number) >= spec.min) && (spec.max === undefined || (value as number) <= spec.max);
    if (!valid) { setInvalid(true); return; }
    const result = await editImageProject(`修改${spec.label}`, [{ type: "update_object", id: object.id, patch: { [spec.key]: value } as ImageObjectPatch }]);
    setInvalid(result.outcome === "refused");
  };
  return (
    <TextField className={styles.field!} isDisabled={disabled} isInvalid={invalid} value={draft} onChange={setDraft}
      onBlur={() => void commit()} onKeyDown={(event) => { if (event.key === "Enter") void commit(); if (event.key === "Escape") setDraft(shown); }}>
      <Label>{spec.label}</Label>
      <Input inputMode={spec.kind === "int" || spec.kind === "number" ? "decimal" : "text"} />
    </TextField>
  );
}
