import { IMAGE_GROUP_LIMIT, imageObjectGroup, imageObjectInEffect, type ImageDocument, type ImageGroup, type ImageGroupPatch, type ImageSceneObject } from "@pi67/domain";
import { editImageProjectWithNotice, type ImageEditOutcome, useImageProject } from "./image-project-controller.js";

// Flat layer groups in the page: one block in paint order whose lock and visibility
// apply to every member. The engine keeps the rules; these helpers ask only for edits
// it accepts and select a group by selecting its members.

/** The group the selection is, exactly. */
export function selectedGroup(document: ImageDocument | undefined, selectedIds: readonly string[]): ImageGroup | undefined {
  const first = document?.objects.find((object) => object.id === selectedIds[0]);
  const group = document && first ? imageObjectGroup(document, first) : undefined;
  if (!document || !group) return undefined;
  const members = document.objects.filter((object) => object.group_id === group.id);
  return members.length === selectedIds.length && members.every((object) => selectedIds.includes(object.id)) ? group : undefined;
}

/** Two or more layers, none locked or already grouped, can become a group while the project has room for one. */
export function canGroup(document: ImageDocument | undefined, selectedIds: readonly string[]): boolean {
  if (!document || selectedIds.length < 2 || (document.groups?.length ?? 0) >= IMAGE_GROUP_LIMIT) return false;
  return selectedIds.every((id) => {
    const object = document.objects.find((item) => item.id === id);
    return object !== undefined && object.group_id === undefined && !imageObjectInEffect(document, object).locked;
  });
}

/** Groups the selected layers as `编组 N` (ids `group`, `group-2`… never taken by a layer or group) and keeps them selected. */
export async function groupSelectedLayers(): Promise<ImageEditOutcome | undefined> {
  const { document, selectedObjectIds } = useImageProject.getState();
  if (!document || !canGroup(document, selectedObjectIds)) return undefined;
  const taken = new Set([...document.objects.map((object) => object.id), ...(document.groups ?? []).map((group) => group.id)]);
  let id = "group", index = 1;
  while (taken.has(id)) { index += 1; id = `group-${index}`; }
  const result = await editImageProjectWithNotice("编组", [{ type: "group_objects", group: { id, name: `编组 ${index}` }, ids: [...selectedObjectIds] }]);
  return result;
}

export function ungroupImageGroup(group: ImageGroup): Promise<ImageEditOutcome> {
  return editImageProjectWithNotice("取消编组", [{ type: "ungroup", id: group.id }]);
}

export function updateImageGroup(group: ImageGroup, summary: string, patch: ImageGroupPatch): Promise<ImageEditOutcome> {
  return editImageProjectWithNotice(summary, [{ type: "update_group", id: group.id, patch }]);
}

/** Layers bottom to top in blocks: a group's members together, every other layer alone. */
export function layerBlocks(objects: readonly ImageSceneObject[]): ImageSceneObject[][] {
  const blocks: ImageSceneObject[][] = [];
  for (const object of objects) {
    const last = blocks.at(-1);
    if (object.group_id !== undefined && last?.[0]?.group_id === object.group_id) last.push(object);
    else blocks.push([object]);
  }
  return blocks;
}

/**
 * The paint order after moving one step up (1) or down (−1): a member moves within its
 * group, anything else steps over the whole neighbouring block. Undefined at an end.
 */
export function movedOrder(objects: readonly ImageSceneObject[], object: ImageSceneObject, direction: 1 | -1, whole?: ImageGroup): string[] | undefined {
  if (!whole && object.group_id !== undefined) {
    const ids = objects.map((item) => item.id), index = ids.indexOf(object.id), target = index + direction;
    if (objects[target]?.group_id !== object.group_id) return undefined;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    return ids;
  }
  const blocks = layerBlocks(objects);
  const index = blocks.findIndex((block) => whole ? block[0]?.group_id === whole.id : block[0]?.id === object.id), target = index + direction;
  if (index < 0 || target < 0 || target >= blocks.length) return undefined;
  [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
  return blocks.flat().map((item) => item.id);
}
