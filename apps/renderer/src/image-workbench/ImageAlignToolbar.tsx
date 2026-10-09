import type { ImageCanvas, ImageSceneObject } from "@pi67/domain";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  type LucideIcon
} from "lucide-react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { alignRects, type AlignMode } from "./image-canvas-geometry.js";
import { editImageProjectWithNotice } from "./image-project-controller.js";
import styles from "./ImageInspector.module.css";

const ALIGN: readonly { mode: AlignMode; label: string; Icon: LucideIcon }[] = [
  { mode: "left", label: "左对齐", Icon: AlignStartVertical },
  { mode: "hcenter", label: "水平居中", Icon: AlignCenterVertical },
  { mode: "right", label: "右对齐", Icon: AlignEndVertical },
  { mode: "top", label: "顶对齐", Icon: AlignStartHorizontal },
  { mode: "vcenter", label: "垂直居中", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "底对齐", Icon: AlignEndHorizontal }
];
const DISTRIBUTE: readonly { mode: AlignMode; label: string; Icon: LucideIcon }[] = [
  { mode: "hdistribute", label: "水平等距", Icon: AlignHorizontalDistributeCenter },
  { mode: "vdistribute", label: "垂直等距", Icon: AlignVerticalDistributeCenter }
];

/**
 * Align and distribute: one object aligns to the canvas, several to their joint
 * bounds. Locked objects stay where they are; the rest move in one revision.
 */
export function ImageAlignToolbar({ objects, canvas, busy }: { objects: readonly ImageSceneObject[]; canvas: ImageCanvas; busy: boolean }) {
  const movable = objects.filter((object) => !object.locked);
  const apply = (mode: AlignMode, label: string) => {
    const operations = alignRects(movable, mode, canvas)
      .filter((placed) => { const object = movable.find((item) => item.id === placed.id)!; return placed.x !== object.x || placed.y !== object.y; })
      .map((placed) => ({ type: "update_object" as const, id: placed.id, patch: { x: placed.x, y: placed.y } }));
    if (operations.length > 0) void editImageProjectWithNotice(label, operations);
  };
  const button = ({ mode, label, Icon }: (typeof ALIGN)[number], disabled: boolean) => (
    <TooltipTrigger key={mode} closeDelay={80} delay={400}>
      <Button aria-label={objects.length === 1 ? `${label}（相对画布）` : label} className={styles.alignAction!} isDisabled={busy || disabled} onPress={() => apply(mode, label)}>
        <Icon aria-hidden="true" size={15} />
      </Button>
      <Tooltip className={styles.tooltip!} offset={6}>{label}</Tooltip>
    </TooltipTrigger>
  );
  return (
    <div className={styles.alignTools}>
      <div aria-label="对齐" className={styles.alignGroup} role="group">
        <span aria-hidden="true" className={styles.alignCaption}>{objects.length === 1 ? "对齐画布" : "对齐"}</span>
        {ALIGN.map((item) => button(item, movable.length === 0))}
      </div>
      {objects.length > 1 ? (
        <div aria-label="分布" className={styles.alignGroup} role="group">
          <span aria-hidden="true" className={styles.alignCaption}>分布</span>
          {DISTRIBUTE.map((item) => button(item, movable.length < 3))}
        </div>
      ) : null}
      {movable.length < objects.length && movable.length > 0 ? <p className={styles.empty}>已锁定的对象保持不动。</p> : null}
    </div>
  );
}
