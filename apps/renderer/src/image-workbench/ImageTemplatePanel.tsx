import type { ImageDocument } from "@pi67/domain";
import { ImagePlus, LayoutTemplate } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { useImageProject } from "./image-project-controller.js";
import { createFromTemplate, saveAsTemplate } from "./image-project-template.js";
import styles from "./ImageInspector.module.css";
import dialogStyles from "./ImageWorkbench.module.css";
import { imageObjectName } from "./image-object-kinds.js";

/**
 * 导出 → 模板 (P5): a project can be saved as a template; a template starts new projects in
 * which only its slots change and every other layer stays locked.
 */
export function ImageTemplatePanel() {
  const document = useImageProject((state) => state.document);
  const busy = useImageProject((state) => state.busy);
  const [creating, setCreating] = useState(false);
  if (!document) return null;
  const slots = document.template?.slots;
  return (
    <>
      <p className={styles.sectionLabel}>模板</p>
      {slots ? (
        <>
          <p className={styles.readout}>这是一个模板 · {slots.length} 个可替换图层</p>
          <Button className="primary-button" isDisabled={busy || !slots.length} onPress={() => setCreating(true)}><LayoutTemplate aria-hidden="true" size={14} />从模板新建…</Button>
          <p className={styles.empty}>新项目里只有可替换的文字和图片能改，其余图层都会锁定。在属性里为文字或图片图层打开「可替换」。</p>
        </>
      ) : (
        <>
          <Button className="secondary-button" isDisabled={busy} onPress={() => void saveAsTemplate()}><LayoutTemplate aria-hidden="true" size={14} />存为模板</Button>
          <p className={styles.empty}>把这一版复制成模板放进创作库，所有文字和图片图层先设为可替换；这个项目不受影响。</p>
        </>
      )}
      {creating && slots ? <NewFromTemplateDialog document={document} onDismiss={() => setCreating(false)} /> : null}
    </>
  );
}

/** The new project's title, each text slot's words (prefilled) and an optional new picture per image slot. */
function NewFromTemplateDialog({ document, onDismiss }: { document: ImageDocument; onDismiss: () => void }) {
  const slots = document.template?.slots ?? [];
  const texts = document.objects.filter((object) => object.kind === "text" && slots.includes(object.id));
  const images = document.objects.filter((object) => object.kind === "image" && slots.includes(object.id));
  const [title, setTitle] = useState(document.title.replace(/ · 模板$/u, ""));
  const [words, setWords] = useState<Record<string, string>>(Object.fromEntries(texts.map((object) => [object.id, object.kind === "text" ? object.text : ""])));
  const [pictures, setPictures] = useState<Record<string, File>>({});
  const [working, setWorking] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const create = async () => {
    setWorking(true);
    try { if (await createFromTemplate({ title, texts: words, images: pictures })) onDismiss(); }
    finally { setWorking(false); }
  };
  return (
    <ModalOverlay className="modal-overlay" isDismissable={!working} isOpen onOpenChange={(open) => { if (!open && !working) onDismiss(); }}>
      <Modal className={`modal-surface ${dialogStyles.dialogModal}`}>
        <Dialog aria-label="从模板新建" className={dialogStyles.dialog!}>
          <span className="dialog-eyebrow">模板</span>
          <Heading slot="title">从模板新建</Heading>
          <TextField className={dialogStyles.dialogField!} isRequired maxLength={200} value={title} onChange={setTitle}>
            <Label>项目名称</Label>
            <Input autoFocus />
          </TextField>
          {texts.map((object) => (
            <TextField key={object.id} className={dialogStyles.dialogField!} maxLength={2000} value={words[object.id] ?? ""} onChange={(value) => setWords((current) => ({ ...current, [object.id]: value }))}>
              {/* Named by the words it replaces, never by the layer's internal id. */}
              <Label>原文「{object.kind === "text" ? object.text.slice(0, 24) : object.id}」</Label>
              <Input />
            </TextField>
          ))}
          {images.map((object) => (
            <div key={object.id} className={dialogStyles.dialogSlot}>
              <span className={dialogStyles.dialogSlotName}>{imageObjectName(object)}<span>{pictures[object.id]?.name ?? "沿用模板里的图片"}</span></span>
              <input ref={(element) => { inputs.current[object.id] = element; }} accept="image/png,image/jpeg,image/webp" className={dialogStyles.fileInput} tabIndex={-1} type="file"
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setPictures((current) => ({ ...current, [object.id]: file })); }} />
              <Button className="secondary-button" isDisabled={working} onPress={() => inputs.current[object.id]?.click()}><ImagePlus aria-hidden="true" size={14} />换图片…</Button>
            </div>
          ))}
          <p className={dialogStyles.dialogHint}>新图片按原图层的框和适配方式放入；文字放不下会先缩小，最多到 70%。其余图层在新项目里都是锁定的。</p>
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={working} onPress={onDismiss}>取消</Button>
            <Button className="primary-button" isDisabled={working || !title.trim()} onPress={() => void create()}>{working ? "正在创建…" : "创建项目"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
