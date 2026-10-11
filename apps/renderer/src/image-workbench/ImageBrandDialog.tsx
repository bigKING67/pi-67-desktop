import { IMAGE_BRAND_LIMITS, type ImageBrandSpec } from "@pi67/domain";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { addBrandFile, editBrand, loadBrand, nextBrandId, specDetail, useImageBrand } from "./image-brand.js";
import styles from "./ImageWorkbench.module.css";

const HEX = /^#[0-9a-fA-F]{6}$/u;

/**
 * 品牌库 (P5): the library's colours, fonts, logos and the person's own export specs, shared by
 * every project. Each change is one version; a stale view reloads before acting again.
 */
export function ImageBrandDialog({ onDismiss }: { onDismiss: () => void }) {
  const kit = useImageBrand((state) => state.kit);
  const busy = useImageBrand((state) => state.busy);
  useEffect(() => { void loadBrand(); }, []);
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Modal className={`modal-surface ${styles.dialogModal} ${styles.brandModal}`}>
        <Dialog aria-label="品牌库" className={styles.dialog!}>
          <span className="dialog-eyebrow">创作库</span>
          <Heading slot="title">品牌库</Heading>
          <p className={styles.dialogHint}>这里的颜色、字体、Logo 和导出规格对创作库里的所有项目可用；规格由你按平台要求填写，白底指图片四边像素全白。</p>
          {!kit ? <p className={styles.dialogHint} role="status">正在读取…</p> : (
            <div className={styles.brandSections}>
              <BrandSection title="颜色" empty="还没有品牌颜色。">
                {kit.colors.map((color) => (
                  <BrandRow key={color.id} busy={busy} label={color.name} detail={color.value} swatch={color.value}
                    onRemove={() => void editBrand("移除颜色", [{ type: "remove_color", id: color.id }])} />
                ))}
              </BrandSection>
              {kit.colors.length < IMAGE_BRAND_LIMITS.colors ? <ColorForm busy={busy} onAdd={(name, value) => editBrand("添加颜色", [{ type: "set_color", color: { id: nextBrandId(kit.colors, "color"), name, value } }])} /> : null}
              <BrandSection title="字体" empty="还没有品牌字体。">
                {kit.fonts.map((font) => <BrandRow key={font.id} busy={busy} label={font.family} detail={font.format.toUpperCase()} onRemove={() => void editBrand("移除字体", [{ type: "remove_font", id: font.id }])} />)}
              </BrandSection>
              <FileButton accept=".ttf,.otf" busy={busy || kit.fonts.length >= IMAGE_BRAND_LIMITS.fonts} label="添加字体…" onFile={(file) => void addBrandFile(file, "font")} />
              <BrandSection title="Logo" empty="还没有 Logo。">
                {kit.logos.map((logo) => <BrandRow key={logo.id} busy={busy} label={logo.name} detail={`${logo.width}×${logo.height}`} onRemove={() => void editBrand("移除 Logo", [{ type: "remove_logo", id: logo.id }])} />)}
              </BrandSection>
              <FileButton accept="image/png,image/jpeg,image/webp" busy={busy || kit.logos.length >= IMAGE_BRAND_LIMITS.logos} label="添加 Logo…" onFile={(file) => void addBrandFile(file, "logo")} />
              <BrandSection title="导出规格" empty="还没有规格。按平台要求添加，例如尺寸、文件大小上限和白底。">
                {kit.specs.map((spec) => <BrandRow key={spec.id} busy={busy} label={spec.name} detail={specDetail(spec)} onRemove={() => void editBrand("移除规格", [{ type: "remove_spec", id: spec.id }])} />)}
              </BrandSection>
              {kit.specs.length < IMAGE_BRAND_LIMITS.specs ? <SpecForm busy={busy} onAdd={(spec) => editBrand("添加规格", [{ type: "set_spec", spec: { ...spec, id: nextBrandId(kit.specs, "spec") } }])} /> : null}
            </div>
          )}
          <div className="dialog-actions">
            <Button className="secondary-button" onPress={onDismiss}>完成</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function BrandSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section aria-label={title} className={styles.brandSection}>
      <h3>{title}</h3>
      {children.length ? <ul>{children}</ul> : <p className={styles.dialogHint}>{empty}</p>}
    </section>
  );
}

function BrandRow({ label, detail, swatch, busy, onRemove }: { label: string; detail: string; swatch?: string; busy: boolean; onRemove: () => void }) {
  return (
    <li className={styles.brandRow}>
      {swatch ? <span aria-hidden="true" className={styles.brandSwatch} style={{ background: swatch }} /> : null}
      <span className={styles.brandLabel}>{label}<span>{detail}</span></span>
      <Button aria-label={`移除 ${label}`} className={styles.brandRemove!} isDisabled={busy} onPress={onRemove}>移除</Button>
    </li>
  );
}

function FileButton({ accept, label, busy, onFile }: { accept: string; label: string; busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} accept={accept} className={styles.fileInput} tabIndex={-1} type="file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
      <Button className={`secondary-button ${styles.brandAdd}`} isDisabled={busy} onPress={() => input.current?.click()}><Plus aria-hidden="true" size={14} />{label}</Button>
    </>
  );
}

function ColorForm({ busy, onAdd }: { busy: boolean; onAdd: (name: string, value: string) => Promise<boolean> }) {
  const [name, setName] = useState(""), [value, setValue] = useState("#");
  const valid = name.trim().length > 0 && HEX.test(value.trim());
  return (
    <form aria-label="添加颜色" className={styles.brandForm} onSubmit={(event) => { event.preventDefault(); if (valid) void onAdd(name.trim(), value.trim().toLowerCase()).then((done) => { if (done) { setName(""); setValue("#"); } }); }}>
      <TextField className={styles.dialogField!} maxLength={IMAGE_BRAND_LIMITS.name} value={name} onChange={setName}><Label>颜色名称</Label><Input /></TextField>
      <TextField className={styles.dialogField!} maxLength={7} value={value} onChange={setValue}><Label>色值</Label><Input /></TextField>
      <Button className="secondary-button" isDisabled={busy || !valid} type="submit">添加颜色</Button>
    </form>
  );
}

function SpecForm({ busy, onAdd }: { busy: boolean; onAdd: (spec: Omit<ImageBrandSpec, "id">) => Promise<boolean> }) {
  const [name, setName] = useState(""), [width, setWidth] = useState(""), [height, setHeight] = useState(""), [megabytes, setMegabytes] = useState(""), [white, setWhite] = useState(false);
  const w = Number(width), h = Number(height), mb = megabytes.trim() ? Number(megabytes) : undefined;
  const valid = name.trim().length > 0 && Number.isInteger(w) && Number.isInteger(h) && w >= 64 && h >= 64 && w <= 8192 && h <= 8192
    && (mb === undefined || (Number.isFinite(mb) && mb > 0 && mb <= 100));
  const add = () => void onAdd({ name: name.trim(), width: w, height: h, ...(mb === undefined ? {} : { max_bytes: Math.round(mb * 1_000_000) }), ...(white ? { background: "white" as const } : {}) })
    .then((done) => { if (done) { setName(""); setWidth(""); setHeight(""); setMegabytes(""); setWhite(false); } });
  return (
    <form aria-label="添加规格" className={styles.brandForm} onSubmit={(event) => { event.preventDefault(); if (valid) add(); }}>
      <TextField className={styles.dialogField!} maxLength={IMAGE_BRAND_LIMITS.name} value={name} onChange={setName}><Label>规格名称</Label><Input /></TextField>
      <TextField className={styles.dialogField!} inputMode="numeric" value={width} onChange={setWidth}><Label>宽</Label><Input /></TextField>
      <TextField className={styles.dialogField!} inputMode="numeric" value={height} onChange={setHeight}><Label>高</Label><Input /></TextField>
      <TextField className={styles.dialogField!} inputMode="decimal" value={megabytes} onChange={setMegabytes}><Label>最大 MB（可选）</Label><Input /></TextField>
      <label className={styles.brandCheck}><input checked={white} onChange={(event) => setWhite(event.currentTarget.checked)} type="checkbox" />要求白底</label>
      <Button className="secondary-button" isDisabled={busy || !valid} type="submit">添加规格</Button>
    </form>
  );
}
