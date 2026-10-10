import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { renderProject } from "./render.js";
import { SCHEMA, SCHEMA_V3, validateDocument } from "./document.js";
import { tempDirectory } from "./test-support/harness.js";

// P4 checkpoint 7: flat groups, contiguous in paint order; lock and visibility apply to
// every member, opacity to the group as one picture.

const rect = (id: string, x: number, color: string) => ({ id, kind: "rect", locked: false, visible: true, x, y: 0, width: 100, height: 100, opacity: 1, color, radius: 0 });

async function project() {
  const directory = await tempDirectory("image-engine-编组-");
  const root = path.join(directory, "poster");
  // Bottom to top: a, b, c, d; b and d overlap a's right half and c sits apart.
  await createProject(root, { project_id: "poster", title: "编组", canvas: { width: 300, height: 100, background: "#ffffff" }, assets: [],
    objects: [rect("a", 0, "#00ff00"), rect("b", 50, "#0000ff"), rect("c", 200, "#000000"), rect("d", 100, "#ff0000")] });
  return { directory, root };
}
const edit = (root: string, base: number, operations: unknown[], summary = "编辑") => editBatch(root, { base_revision: base, author: "human", summary, operations });
const order = async (root: string) => (await readProject(root)).document.objects.map((object) => `${object.id}${object.group_id ? `:${object.group_id}` : ""}`);
async function pixels(root: string, directory: string, name: string) {
  await renderProject(root, path.join(directory, name));
  const { data, info } = await sharp(await fs.readFile(path.join(directory, name, "image.png"))).raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
}
const near = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) <= 3);
const group = (id: string, ids: string[]) => ({ type: "group_objects", group: { id, name: "组" }, ids });

describe("layer groups", { timeout: 120_000 }, () => {
  it("gathers members next to the topmost one, keeps them whole, and drops the group with its last member", async () => {
    const { root } = await project();
    const grouped = await edit(root, 1, [group("g", ["b", "d"])]);
    expect(grouped.document.schema).toBe(SCHEMA_V3);
    expect(grouped.document.groups).toEqual([{ id: "g", name: "组", locked: false, visible: true, opacity: 1 }]);
    expect(await order(root)).toEqual(["a", "c", "b:g", "d:g"]);
    // Anything that would split the group is refused.
    await expect(edit(root, 2, [{ type: "reorder_objects", ids: ["a", "b", "c", "d"] }])).rejects.toThrow(/must be contiguous/u);
    await expect(edit(root, 2, [{ type: "update_object", id: "a", patch: { group_id: "g" } }])).rejects.toThrow(/must be contiguous/u);
    await expect(edit(root, 2, [group("h", ["b"])])).rejects.toThrow(/already in a group/u);
    await expect(edit(root, 2, [group("c", ["a"])])).rejects.toThrow(/Duplicate group id c/u);
    await expect(edit(root, 2, [group("g", ["a"])])).rejects.toThrow(/Duplicate group id g/u);
    // Moving the block as a whole is fine; joining from next to it too.
    await edit(root, 2, [{ type: "reorder_objects", ids: ["b", "d", "a", "c"] }]);
    await edit(root, 3, [{ type: "update_object", id: "a", patch: { group_id: "g" } }]);
    expect(await order(root)).toEqual(["b:g", "d:g", "a:g", "c"]);
    await edit(root, 4, [{ type: "remove_object", id: "b" }, { type: "remove_object", id: "d" }, { type: "update_object", id: "a", patch: { group_id: null } }]);
    const plain = await readProject(root);
    expect(plain.document).not.toHaveProperty("groups");
    expect(plain.document.schema).toBe(SCHEMA);
  });

  it("locks every member with its group, through edits, ungrouping, joining and revert", async () => {
    const { root } = await project();
    await edit(root, 1, [group("g", ["b", "d"])]);
    await expect(edit(root, 2, [{ type: "update_group", id: "g", patch: { locked: true, name: "锁" } }])).rejects.toThrow(/Lock changes must be isolated/u);
    await edit(root, 2, [{ type: "update_group", id: "g", patch: { locked: true } }]);
    await expect(edit(root, 3, [{ type: "update_object", id: "b", patch: { x: 10 } }])).rejects.toThrow(/Object is locked: b/u);
    await expect(edit(root, 3, [{ type: "remove_object", id: "d" }])).rejects.toThrow(/Object is locked: d/u);
    await expect(edit(root, 3, [{ type: "reorder_objects", ids: ["c", "b", "d", "a"] }])).rejects.toThrow(/locked object/u);
    await expect(edit(root, 3, [{ type: "update_group", id: "g", patch: { opacity: 0.5 } }])).rejects.toThrow(/Group is locked/u);
    await expect(edit(root, 3, [{ type: "ungroup", id: "g" }])).rejects.toThrow(/Group is locked/u);
    await expect(edit(root, 3, [{ type: "update_object", id: "c", patch: { group_id: "g" } }])).rejects.toThrow(/Group is locked/u);
    await expect(edit(root, 3, [{ type: "revert_to", revision: 1 }])).rejects.toThrow(/Revert would change locked object/u);
    await edit(root, 3, [{ type: "update_group", id: "g", patch: { locked: false } }]);
    // An undo cannot bring a layer back into a locked group either.
    await edit(root, 4, [{ type: "update_object", id: "b", patch: { group_id: null } }]);
    await edit(root, 5, [{ type: "update_group", id: "g", patch: { locked: true } }]);
    await expect(edit(root, 6, [{ type: "revert_to", revision: 4 }])).rejects.toThrow(/Group is locked: g/u);
    await edit(root, 6, [{ type: "update_group", id: "g", patch: { locked: false } }]);
    // Ungrouping keeps how the members looked: hidden stays hidden, a see-through group's opacity stays on each.
    await edit(root, 7, [{ type: "update_group", id: "g", patch: { visible: false, opacity: 0.5 } }]);
    const loose = await edit(root, 8, [{ type: "ungroup", id: "g" }]);
    expect(loose.document.objects.find((object) => object.id === "d")).toMatchObject({ visible: false, opacity: 0.5 });
    expect(loose.document.objects.find((object) => object.id === "b")).toMatchObject({ visible: true, opacity: 1 });
    await expect(edit(root, 9, [{ type: "update_group", id: "g", patch: { name: "x" } }])).rejects.toThrow(/Unknown group: g/u);
  });

  it("hides members with their group and draws a see-through group as one picture", async () => {
    const { directory, root } = await project();
    await edit(root, 1, [group("g", ["b", "d"])]);
    await edit(root, 2, [{ type: "update_group", id: "g", patch: { visible: false } }]);
    let at = await pixels(root, directory, "hidden");
    expect(near(at(75, 50), [0, 255, 0])).toBe(true); expect(near(at(150, 50), [255, 255, 255])).toBe(true);
    await edit(root, 3, [{ type: "update_group", id: "g", patch: { visible: true, opacity: 0.5 } }]);
    at = await pixels(root, directory, "half");
    // Where red covers blue, only red shows (half over the green below); blue alone is half over green.
    expect(near(at(120, 50), [255, 128, 128])).toBe(true);
    expect(near(at(75, 50), [0, 128, 128])).toBe(true);
    expect(near(at(25, 50), [0, 255, 0])).toBe(true);
    await expect(edit(root, 4, [{ type: "update_group", id: "g", patch: { opacity: 0.5 } }])).rejects.toThrow(/changes nothing on g/u);
    // A blended member blends within its group at any opacity, never with what lies below.
    await edit(root, 4, [{ type: "update_group", id: "g", patch: { opacity: 1 } }, { type: "update_object", id: "b", patch: { blend: "multiply" } }]);
    at = await pixels(root, directory, "isolated");
    expect(near(at(75, 50), [0, 0, 255])).toBe(true);
  });

  it("validates the groups list", async () => {
    const { root } = await project();
    const doc = (await edit(root, 1, [group("g", ["b", "d"])])).document;
    expect(() => validateDocument({ ...doc, groups: [] })).toThrow(/Invalid groups list/u);
    expect(() => validateDocument({ ...doc, groups: [...doc.groups!, { id: "h", name: "空", locked: false, visible: true, opacity: 1 }] })).toThrow(/Empty group h/u);
    expect(() => validateDocument({ ...doc, groups: [{ ...doc.groups![0]!, name: " " }] })).toThrow(/Invalid group name/u);
    expect(() => validateDocument({ ...doc, objects: doc.objects.map((object) => object.id === "a" ? { ...object, group_id: "x" } : object) })).toThrow(/Missing group for a/u);
    const { groups: _groups, ...withoutGroups } = doc;
    expect(() => validateDocument(withoutGroups)).toThrow(/Missing group for b/u);
  });
});
