import type { ImageSceneObject } from "@pi67/domain";
import { ArrowDown, ArrowUp, Circle, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Square, Type } from "lucide-react";
import { Button } from "react-aria-components";
import { addImageObject, type NewObjectKind } from "./image-project-additions.js";
import {
  editImageProjectWithNotice,
  type ImageProjectState,
  selectImageObject,
  toggleImageObjectLock,
  toggleImageObjectVisibility,
  useImageProject
} from "./image-project-controller.js";
import { IMAGE_OBJECT_KIND_LABELS } from "./image-object-kinds.js";
import styles from "./ImageInspector.module.css";

const KIND_ICONS = { image: ImageIcon, text: Type, rect: Square, ellipse: Circle } as const;
const ADDABLE: readonly NewObjectKind[] = ["text", "rect", "ellipse"];

/** Adds a text, rectangle or ellipse layer, centred and selected. */
function AddLayer({ busy }: { busy: boolean }) {
  return (
    <div aria-label="添加图层" className={styles.addLayer} role="group">
      <span className={styles.alignCaption}>添加</span>
      {ADDABLE.map((kind) => {
        const Icon = KIND_ICONS[kind], label = IMAGE_OBJECT_KIND_LABELS[kind];
        return (
          <Button key={kind} aria-label={`添加${label}`} className={styles.historyAction!} isDisabled={busy} onPress={() => void addImageObject(kind)}>
            <Icon aria-hidden="true" size={12} />{label}
          </Button>
        );
      })}
    </div>
  );
}
/** A stable empty list: a fresh `[]` per snapshot loops the store subscription before the document loads. */
const NO_OBJECTS: readonly ImageSceneObject[] = [];
export const selectImageObjects = (state: Pick<ImageProjectState, "document">): readonly ImageSceneObject[] => state.document?.objects ?? NO_OBJECTS;

/** 图层: top-down list (the last object paints on top), visibility, lock and order, synced with the canvas. Shift adds to the selection. */
export function ImageLayersPanel() {
  const objects = useImageProject(selectImageObjects);
  const selectedIds = useImageProject((state) => state.selectedObjectIds);
  const busy = useImageProject((state) => state.busy);
  const topDown = [...objects].reverse();
  const move = (object: ImageSceneObject, direction: 1 | -1) => {
    const ids = objects.map((item) => item.id);
    const index = ids.indexOf(object.id), target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void editImageProjectWithNotice(direction > 0 ? "上移图层" : "下移图层", [{ type: "reorder_objects", ids }]);
  };
  // Adding stays available with no layers at all, the one state where it is the only way on.
  if (objects.length === 0) return <><AddLayer busy={busy} /><p className={styles.empty}>项目还没有图层。</p></>;
  return (
    <>
    <AddLayer busy={busy} />
    <ul aria-label="图层" className={styles.layers}>
      {topDown.map((object, position) => {
        const Icon = KIND_ICONS[object.kind];
        const name = object.kind === "text" ? object.text : object.id;
        const selected = selectedIds.includes(object.id);
        return (
          <li key={object.id} className={`${styles.layer} ${selected ? styles.layerSelected : ""}`}>
            <Button aria-label={`选择图层 ${name}`} aria-pressed={selected} className={styles.layerName!} onPress={(event) => selectImageObject(object.id, { extend: event.shiftKey })}>
              <Icon aria-hidden="true" className={styles.layerIcon} size={14} />
              <span className={object.visible ? "" : styles.layerHidden}>{name}</span>
            </Button>
            <span className={styles.layerActions}>
              <Button aria-label={object.visible ? `隐藏 ${name}` : `显示 ${name}`} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectVisibility(object)}>
                {object.visible ? <Eye aria-hidden="true" size={13} /> : <EyeOff aria-hidden="true" size={13} />}
              </Button>
              <Button aria-label={object.locked ? `解锁 ${name}` : `锁定 ${name}`} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectLock(object)}>
                {object.locked ? <Lock aria-hidden="true" size={13} /> : <LockOpen aria-hidden="true" size={13} />}
              </Button>
              <Button aria-label={`上移 ${name}`} className={styles.layerAction!} isDisabled={busy || position === 0 || object.locked} onPress={() => move(object, 1)}>
                <ArrowUp aria-hidden="true" size={13} />
              </Button>
              <Button aria-label={`下移 ${name}`} className={styles.layerAction!} isDisabled={busy || position === topDown.length - 1 || object.locked} onPress={() => move(object, -1)}>
                <ArrowDown aria-hidden="true" size={13} />
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
    </>
  );
}
