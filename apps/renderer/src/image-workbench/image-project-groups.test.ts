import type { ImageDocument, ImageSceneObject } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { canGroup, layerBlocks, movedOrder, selectedGroup } from "./image-project-groups.js";

const object = (id: string, group_id?: string, locked = false): ImageSceneObject =>
  ({ id, kind: "rect", locked, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#000000", radius: 0, ...(group_id ? { group_id } : {}) });
// Bottom to top: a, then group g (b, c), then d.
const objects = [object("a"), object("b", "g"), object("c", "g"), object("d")];
const document = { groups: [{ id: "g", name: "组", locked: false, visible: true, opacity: 1 }], objects } as unknown as ImageDocument;
const g = document.groups![0]!;

describe("layer groups in the page", () => {
  it("reads blocks bottom to top and moves a layer over a whole group, a member within it, and a group as one", () => {
    expect(layerBlocks(objects).map((block) => block.map((item) => item.id).join(""))).toEqual(["a", "bc", "d"]);
    expect(movedOrder(objects, objects[0]!, 1)).toEqual(["b", "c", "a", "d"]);
    expect(movedOrder(objects, objects[3]!, -1)).toEqual(["a", "d", "b", "c"]);
    expect(movedOrder(objects, objects[1]!, 1)).toEqual(["a", "c", "b", "d"]);
    expect(movedOrder(objects, objects[2]!, 1)).toBeUndefined();
    expect(movedOrder(objects, objects[1]!, 1, g)).toEqual(["a", "d", "b", "c"]);
    expect(movedOrder(objects, objects[1]!, -1, g)).toEqual(["b", "c", "a", "d"]);
    expect(movedOrder(objects, objects[3]!, 1)).toBeUndefined();
  });

  it("knows when the selection is exactly a group, and what may be grouped", () => {
    expect(selectedGroup(document, ["c", "b"])).toBe(g);
    expect(selectedGroup(document, ["b"])).toBeUndefined();
    expect(selectedGroup(document, ["b", "c", "d"])).toBeUndefined();
    expect(canGroup(document, ["a", "d"])).toBe(true);
    expect(canGroup(document, ["a"])).toBe(false);
    expect(canGroup(document, ["a", "b"])).toBe(false);
    expect(canGroup({ ...document, objects: [object("a", undefined, true), ...objects.slice(1)] }, ["a", "d"])).toBe(false);
    expect(canGroup({ ...document, groups: Array.from({ length: 32 }, (_, index) => ({ ...g, id: `g${index}` })) }, ["a", "d"])).toBe(false);
  });
});
