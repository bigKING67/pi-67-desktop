import type { ImageTextObject } from "@pi67/domain";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { checkImageEdit, editImageProject, type ImageEditOutcome } from "./image-project-controller.js";
import styles from "./ImageCanvas.module.css";

const CHECK_DELAY_MS = 300;

type Fit = { state: "unchanged" } | { state: "checking" } | { state: "fits" } | { state: "refused"; message: string };

/** A backdrop that keeps the words readable over the rendered pixels they replace. */
function backdropFor(color: string): "light" | "dark" {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.5 ? "light" : "dark";
}

/**
 * Edits one text object in place, at its box and scaled type (flow E). The
 * engine checks every draft without publishing (glyphs, layout), so words that
 * would overflow are named while typing and never submitted. Enter adds a line,
 * ⌘/Ctrl + Enter or leaving the field saves, Escape restores the words.
 */
export function ImageInlineTextEditor({ object, frame, scale, onClose }: {
  object: ImageTextObject;
  frame: { left: number; top: number; width: number; height: number };
  scale: number;
  onClose: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(object.text);
  const [fit, setFit] = useState<Fit>({ state: "unchanged" });
  const [saving, setSaving] = useState(false);
  const closed = useRef(false);

  useLayoutEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  // The field grows with the words so nothing scrolls out of sight; the box outline marks the space they have.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(frame.height, element.scrollHeight)}px`;
  }, [draft, frame.height]);
  useEffect(() => {
    if (draft === object.text) { setFit({ state: "unchanged" }); return undefined; }
    if (!draft.trim()) { setFit({ state: "refused", message: "文字不能为空；不需要这行字可以在图层里隐藏它。" }); return undefined; }
    setFit({ state: "checking" });
    let current = true;
    const timer = window.setTimeout(() => {
      void checkImageEdit([{ type: "update_object", id: object.id, patch: { text: draft } }]).then((result) => {
        if (current) setFit(result.outcome === "applied" ? { state: "fits" } : { state: "refused", message: result.outcome === "refused" ? result.message : "项目刚被更新，请稍后再试。" });
      });
    }, CHECK_DELAY_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [draft, object.id, object.text]);

  const close = () => { if (!closed.current) { closed.current = true; onClose(); } };
  // Leaving the field saves too, but never pulls focus back: a refused draft just stays open.
  const save = async (explicit: boolean) => {
    if (saving || closed.current) return;
    if (draft === object.text) { close(); return; }
    if (fit.state === "refused") { if (explicit) field.current?.focus(); return; }
    setSaving(true);
    const result: ImageEditOutcome = await editImageProject("修改文字", [{ type: "update_object", id: object.id, patch: { text: draft } }]);
    setSaving(false);
    if (result.outcome === "applied") { close(); return; }
    // A refusal or a newer revision keeps the draft in place for another try.
    setFit({ state: "refused", message: result.outcome === "refused" ? result.message : "Agent 刚更新了项目，你的文字还在，再保存一次即可。" });
    if (explicit) field.current?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(true); }
  };

  const status = fit.state === "refused" ? fit.message : fit.state === "checking" ? "正在检查排版…" : fit.state === "fits" ? "放得下 · ⌘↵ 保存" : "Esc 取消 · ⌘↵ 保存";
  return (
    <div className={styles.textEditor} data-overflow={fit.state === "refused"} style={frame}>
      <textarea
        ref={field}
        aria-describedby={`text-fit-${object.id}`}
        aria-invalid={fit.state === "refused"}
        aria-label={`编辑文字 ${object.id}`}
        className={styles.textField}
        data-backdrop={backdropFor(object.color)}
        disabled={saving}
        spellCheck={false}
        style={{ color: object.color, fontSize: object.font_size * scale, lineHeight: object.line_height, textAlign: object.align }}
        value={draft}
        onBlur={() => void save(false)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={keyDown}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <span className={styles.textStatus} data-state={fit.state} id={`text-fit-${object.id}`} role="status">{saving ? "正在保存…" : status}</span>
    </div>
  );
}
