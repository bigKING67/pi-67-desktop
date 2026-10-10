import { imageObjectInEffect, type ImageDocument, type ImageGroup, type ImageSceneObject } from "@pi67/domain";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Circle, Eye, EyeOff, Folder, Image as ImageIcon, Lock, LockOpen, Square, Type } from "lucide-react";
import { useState } from "react";
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
import { canGroup, groupSelectedLayers, layerBlocks, movedOrder, selectedGroup, ungroupImageGroup, updateImageGroup } from "./image-project-groups.js";
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

/** 编组 / 取消编组 for the selection, in their own row so the 添加 row never wraps. */
function GroupActions({ busy, document, selectedIds }: { busy: boolean; document: ImageDocument | undefined; selectedIds: readonly string[] }) {
  const group = selectedGroup(document, selectedIds), groupable = canGroup(document, selectedIds);
  if (!group && !groupable) return null;
  return (
    <div aria-label="编组" className={styles.addLayer} role="group">
      <span className={styles.alignCaption}>选中</span>
      {groupable ? (
        <Button aria-keyshortcuts="Meta+G" className={styles.historyAction!} isDisabled={busy} onPress={() => void groupSelectedLayers()}><Folder aria-hidden="true" size={12} />编组</Button>
      ) : null}
      {group ? (
        <Button aria-keyshortcuts="Shift+Meta+G" className={styles.historyAction!} isDisabled={busy || group.locked} onPress={() => void ungroupImageGroup(group)}>取消编组</Button>
      ) : null}
    </div>
  );
}
/** A stable empty list: a fresh `[]` per snapshot loops the store subscription before the document loads. */
const NO_OBJECTS: readonly ImageSceneObject[] = [];
export const selectImageObjects = (state: Pick<ImageProjectState, "document">): readonly ImageSceneObject[] => state.document?.objects ?? NO_OBJECTS;

/**
 * 图层: top-down list (the last object paints on top), synced with the canvas. A group is a
 * row of its own — select, show, lock and move it whole — over its members, indented. Shift
 * adds to the selection; a member's own row selects just that member.
 */
export function ImageLayersPanel() {
  const document = useImageProject((state) => state.document);
  const objects = useImageProject(selectImageObjects);
  const selectedIds = useImageProject((state) => state.selectedObjectIds);
  const busy = useImageProject((state) => state.busy);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const move = (object: ImageSceneObject, direction: 1 | -1, whole?: ImageGroup) => {
    const ids = movedOrder(objects, object, direction, whole);
    if (ids) void editImageProjectWithNotice(direction > 0 ? "上移图层" : "下移图层", [{ type: "reorder_objects", ids }]);
  };
  // Adding stays available with no layers at all, the one state where it is the only way on.
  if (!document || objects.length === 0) return <><AddLayer busy={busy} /><GroupActions busy={busy} document={document} selectedIds={selectedIds} /><p className={styles.empty}>项目还没有图层。</p></>;
  const blocks = layerBlocks(objects).reverse();
  return (
    <>
    <AddLayer busy={busy} /><GroupActions busy={busy} document={document} selectedIds={selectedIds} />
    <ul aria-label="图层" className={styles.layers}>
      {blocks.flatMap((block, position) => {
        const first = block[0]!, group = document.groups?.find((item) => item.id === first.group_id);
        const ends = { top: position === 0, bottom: position === blocks.length - 1 };
        if (!group) return [<LayerRow key={first.id} busy={busy} document={document} ends={ends} object={first} selected={selectedIds.includes(first.id)} onMove={move} />];
        const open = !collapsed.has(group.id);
        const members = [...block].reverse();
        return [
          <GroupRow key={`group-${group.id}`} busy={busy} ends={ends} group={group} open={open} selected={members.every((object) => selectedIds.includes(object.id))}
            onMove={(direction) => move(first, direction, group)}
            onToggle={() => setCollapsed((current) => { const next = new Set(current); if (open) next.add(group.id); else next.delete(group.id); return next; })} />,
          ...(open ? members.map((object, index) => (
            <LayerRow key={object.id} busy={busy} document={document} ends={{ top: index === 0, bottom: index === members.length - 1 }} inGroup object={object}
              selected={selectedIds.includes(object.id)} onMove={move} />
          )) : [])
        ];
      })}
    </ul>
    </>
  );
}

function GroupRow({ group, open, selected, busy, ends, onToggle, onMove }: {
  group: ImageGroup; open: boolean; selected: boolean; busy: boolean; ends: { top: boolean; bottom: boolean }; onToggle: () => void; onMove: (direction: 1 | -1) => void;
}) {
  return (
    <li className={`${styles.layer} ${styles.groupRow} ${selected ? styles.layerSelected : ""}`}>
      <span className={styles.groupHead}>
        <Button aria-expanded={open} aria-label={`${open ? "收起" : "展开"} ${group.name}`} className={styles.layerAction!} onPress={onToggle}>
          {open ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={`选择组 ${group.name}`} aria-pressed={selected} className={styles.layerName!}
          onPress={(event) => { const { document } = useImageProject.getState(); const first = document?.objects.find((object) => object.group_id === group.id); if (first) selectImageObject(first.id, { extend: event.shiftKey }); }}>
          <Folder aria-hidden="true" className={styles.layerIcon} size={14} />
          <span className={group.visible ? "" : styles.layerHidden}>{group.name}</span>
        </Button>
      </span>
      <span className={styles.layerActions}>
        <Button aria-label={group.visible ? `隐藏组 ${group.name}` : `显示组 ${group.name}`} className={styles.layerAction!} isDisabled={busy}
          onPress={() => void updateImageGroup(group, group.visible ? "隐藏组" : "显示组", { visible: !group.visible })}>
          {group.visible ? <Eye aria-hidden="true" size={13} /> : <EyeOff aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={group.locked ? `解锁组 ${group.name}` : `锁定组 ${group.name}`} className={styles.layerAction!} isDisabled={busy}
          onPress={() => void updateImageGroup(group, group.locked ? "解锁组" : "锁定组", { locked: !group.locked })}>
          {group.locked ? <Lock aria-hidden="true" size={13} /> : <LockOpen aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={`上移组 ${group.name}`} className={styles.layerAction!} isDisabled={busy || ends.top || group.locked} onPress={() => onMove(1)}>
          <ArrowUp aria-hidden="true" size={13} />
        </Button>
        <Button aria-label={`下移组 ${group.name}`} className={styles.layerAction!} isDisabled={busy || ends.bottom || group.locked} onPress={() => onMove(-1)}>
          <ArrowDown aria-hidden="true" size={13} />
        </Button>
      </span>
    </li>
  );
}

function LayerRow({ object, document, selected, busy, ends, inGroup = false, onMove }: {
  object: ImageSceneObject; document: ImageDocument; selected: boolean; busy: boolean; ends: { top: boolean; bottom: boolean }; inGroup?: boolean;
  onMove: (object: ImageSceneObject, direction: 1 | -1) => void;
}) {
  const Icon = KIND_ICONS[object.kind];
  const name = object.kind === "text" ? object.text : object.id;
  // A locked or hidden group locks or hides its members; their own toggles stay theirs.
  const effect = imageObjectInEffect(document, object);
  return (
    <li className={`${styles.layer} ${inGroup ? styles.layerInGroup : ""} ${selected ? styles.layerSelected : ""}`}>
      <Button aria-label={`选择图层 ${name}`} aria-pressed={selected} className={styles.layerName!} onPress={(event) => selectImageObject(object.id, { extend: event.shiftKey, single: true })}>
        <Icon aria-hidden="true" className={styles.layerIcon} size={14} />
        <span className={effect.visible ? "" : styles.layerHidden}>{name}</span>
      </Button>
      <span className={styles.layerActions}>
        <Button aria-label={object.visible ? `隐藏 ${name}` : `显示 ${name}`} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectVisibility(object)}>
          {object.visible ? <Eye aria-hidden="true" size={13} /> : <EyeOff aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={object.locked ? `解锁 ${name}` : `锁定 ${name}`} className={styles.layerAction!} isDisabled={busy} onPress={() => void toggleImageObjectLock(object)}>
          {object.locked ? <Lock aria-hidden="true" size={13} /> : <LockOpen aria-hidden="true" size={13} />}
        </Button>
        <Button aria-label={`上移 ${name}`} className={styles.layerAction!} isDisabled={busy || ends.top || effect.locked} onPress={() => onMove(object, 1)}>
          <ArrowUp aria-hidden="true" size={13} />
        </Button>
        <Button aria-label={`下移 ${name}`} className={styles.layerAction!} isDisabled={busy || ends.bottom || effect.locked} onPress={() => onMove(object, -1)}>
          <ArrowDown aria-hidden="true" size={13} />
        </Button>
      </span>
    </li>
  );
}
