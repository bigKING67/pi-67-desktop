import type { ImageSceneObject } from "@pi67/domain";
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Square, Type } from "lucide-react";
import { Button } from "react-aria-components";
import { editImageProject, selectImageObject, useImageProject } from "./image-project-controller.js";
import styles from "./ImageInspector.module.css";

const KIND_ICONS = { image: ImageIcon, text: Type, rect: Square } as const;

/** 图层: top-down list (the last object paints on top), visibility, lock and order, synced with the canvas. */
export function ImageLayersPanel() {
  const objects = useImageProject((state) => state.document?.objects ?? []);
  const selectedId = useImageProject((state) => state.selectedObjectId);
  const busy = useImageProject((state) => state.busy);
  const topDown = [...objects].reverse();
  const move = (object: ImageSceneObject, direction: 1 | -1) => {
    const ids = objects.map((item) => item.id);
    const index = ids.indexOf(object.id), target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void editImageProject(direction > 0 ? "上移图层" : "下移图层", [{ type: "reorder_objects", ids }]);
  };
  if (objects.length === 0) return <p className={styles.empty}>项目还没有图层。</p>;
  return (
    <ul aria-label="图层" className={styles.layers}>
      {topDown.map((object, position) => {
        const Icon = KIND_ICONS[object.kind];
        const name = object.kind === "text" ? object.text : object.id;
        return (
          <li key={object.id} className={`${styles.layer} ${selectedId === object.id ? styles.layerSelected : ""}`}>
            <Button aria-label={`选择图层 ${name}`} aria-pressed={selectedId === object.id} className={styles.layerName!} onPress={() => selectImageObject(object.id)}>
              <Icon aria-hidden="true" className={styles.layerIcon} size={14} />
              <span className={object.visible ? "" : styles.layerHidden}>{name}</span>
            </Button>
            <span className={styles.layerActions}>
              <Button aria-label={object.visible ? `隐藏 ${name}` : `显示 ${name}`} className={styles.layerAction!} isDisabled={busy}
                onPress={() => void editImageProject(object.visible ? "隐藏图层" : "显示图层", [{ type: "update_object", id: object.id, patch: { visible: !object.visible } }])}>
                {object.visible ? <Eye aria-hidden="true" size={13} /> : <EyeOff aria-hidden="true" size={13} />}
              </Button>
              {/* Lock changes are their own batch, as the engine requires. */}
              <Button aria-label={object.locked ? `解锁 ${name}` : `锁定 ${name}`} className={styles.layerAction!} isDisabled={busy}
                onPress={() => void editImageProject(object.locked ? "解锁图层" : "锁定图层", [{ type: "update_object", id: object.id, patch: { locked: !object.locked } }])}>
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
  );
}
