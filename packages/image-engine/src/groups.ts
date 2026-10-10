import { IMAGE_GROUP_LIMIT } from "@pi67/domain";
import { fail } from "./content-store.js";
import { id, isLocked, record, string, type ImageDocument, type JsonRecord, type SceneObject } from "./document.js";

// P4 checkpoint 7: flat layer groups. A group is one contiguous block in paint order;
// its lock and visibility apply to every member, its opacity to the group as one picture.

export const GROUP_OPERATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["group_objects", ["group", "ids"]], ["update_group", ["id", "patch"]], ["ungroup", ["id"]]
]);

export function applyGroupOperation(doc: ImageDocument, type: string, op: JsonRecord): void {
  if (type === "group_objects") return groupObjects(doc, op);
  const index = groupAt(doc, op.id), group = doc.groups![index]!;
  if (type === "ungroup") {
    if (group.locked) fail(`Group is locked: ${group.id}`);
    // Members keep how they looked: a hidden group leaves them hidden, a see-through one leaves its opacity on each.
    for (const object of doc.objects) {
      if (object.group_id !== group.id) continue;
      delete object.group_id;
      if (!group.visible) object.visible = false;
      object.opacity = Math.round(object.opacity * group.opacity * 1000) / 1000;
    }
    doc.groups!.splice(index, 1);
    return;
  }
  record(op.patch, ["name", "locked", "visible", "opacity"], "group patch");
  if (!Object.keys(op.patch).length) fail("Empty group patch");
  if (group.locked && !Object.hasOwn(op.patch, "locked")) fail(`Group is locked: ${group.id}`);
  const next = { ...group, ...structuredClone(op.patch) };
  if (JSON.stringify(next) === JSON.stringify(group)) fail(`Patch changes nothing on ${group.id}`);
  doc.groups![index] = next;
}

/**
 * Gathers the objects next to the topmost of them, keeping their order, into a new group.
 * Refused when a member is locked or already grouped, or when gathering would move a locked object.
 */
function groupObjects(doc: ImageDocument, op: JsonRecord): void {
  record(op.group, ["id", "name"], "new group");
  id(op.group.id, "group id"); string(op.group.name, "group name", 64);
  const groupId = op.group.id, name = op.group.name;
  if ((doc.groups?.length ?? 0) >= IMAGE_GROUP_LIMIT) fail(`A project has at most ${IMAGE_GROUP_LIMIT} groups`);
  if (doc.groups?.some((group) => group.id === groupId) || doc.objects.some((object) => object.id === groupId)) fail(`Duplicate group id ${groupId}`);
  const ids = op.ids;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) fail("A group needs distinct object ids");
  const members = new Set<string>();
  for (const value of ids) {
    id(value, "object id");
    const object = doc.objects.find((item) => item.id === value) ?? fail(`Unknown object: ${value}`);
    if (isLocked(doc, object)) fail(`Object is locked: ${object.id}`);
    if (object.group_id !== undefined) fail(`Object is already in a group: ${object.id}`);
    members.add(object.id);
  }
  const top = doc.objects.findLastIndex((object) => members.has(object.id));
  const others = doc.objects.filter((object) => !members.has(object.id));
  const below = doc.objects.slice(0, top).filter((object) => !members.has(object.id)).length;
  const gathered = doc.objects.filter((object) => members.has(object.id)).map((object): SceneObject => ({ ...object, group_id: groupId }));
  const ordered = [...others.slice(0, below), ...gathered, ...others.slice(below)];
  for (const [index, object] of doc.objects.entries()) {
    if (isLocked(doc, object) && ordered[index]?.id !== object.id) fail(`Grouping would move locked object: ${object.id}`);
  }
  doc.objects = ordered;
  doc.groups = [...doc.groups ?? [], { id: groupId, name, locked: false, visible: true, opacity: 1 }];
}

function groupAt(doc: ImageDocument, groupId: unknown): number {
  id(groupId, "group id");
  const index = doc.groups?.findIndex((group) => group.id === groupId) ?? -1;
  if (index < 0) fail(`Unknown group: ${groupId}`);
  return index;
}

/**
 * A locked group keeps its members exactly, whatever the batch did (an edit, a join from
 * add_object or update_object, or a revert): only unlocking opens it again.
 */
export function keepLockedGroups(before: ImageDocument, after: ImageDocument): void {
  for (const group of before.groups ?? []) {
    if (!group.locked) continue;
    const members = (doc: ImageDocument) => doc.objects.filter((object) => object.group_id === group.id).map((object) => object.id).join("\n");
    if (members(after) !== members(before)) fail(`Group is locked: ${group.id}`);
  }
}

/** Groups whose last member was removed or left go with it. */
export function dropEmptyGroups(doc: ImageDocument): void {
  if (!doc.groups) return;
  doc.groups = doc.groups.filter((group) => doc.objects.some((object) => object.group_id === group.id));
  if (!doc.groups.length) delete doc.groups;
}

