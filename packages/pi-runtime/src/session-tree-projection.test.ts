import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { MAX_TREE_JSON_BYTES, MAX_TREE_NODES } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { projectSessionTree } from "./session-tree-projection.js";

interface TestTreeNode {
  entry: ({
    id: string;
    parentId: string | null;
    type: "message";
    timestamp: string;
    message: { role: "user"; content: string; timestamp: number };
  } | {
    id: string;
    parentId: string | null;
    type: "custom";
    timestamp: string;
    customType: string;
    data: unknown;
  });
  children: TestTreeNode[];
  label?: string;
}

describe("projectSessionTree", () => {
  it("projects a normal tree in stable pre-order with explicit depth", () => {
    const root = treeNode("root", null, "Root");
    const first = treeNode("first", "root", "First");
    const nested = treeNode("nested", "first", "Nested");
    const second = treeNode("second", "root", "Second");
    root.children.push(first, second);
    first.children.push(nested);

    const projection = projectSessionTree(treeSource([root], "nested"));

    expect(projection).toEqual({
      nodes: [
        expect.objectContaining({ id: "root", depth: 0, active: false }),
        expect.objectContaining({ id: "first", depth: 1, active: false }),
        expect.objectContaining({ id: "nested", depth: 2, active: true }),
        expect.objectContaining({ id: "second", depth: 1, active: false })
      ],
      truncated: false,
      total: 4
    });
  });

  it("hides the Desktop Session creation marker and reparents visible descendants", () => {
    const marker = internalMarker("marker", null);
    const user = treeNode("user", "marker", "Prompt");
    const assistant = treeNode("assistant", "user", "Reply");
    marker.children.push(user);
    user.children.push(assistant);

    const projection = projectSessionTree(treeSource([marker], "assistant"));

    expect(projection).toEqual({
      nodes: [
        expect.objectContaining({ id: "user", parentId: null, depth: 0, active: false }),
        expect.objectContaining({ id: "assistant", parentId: "user", depth: 1, active: true })
      ],
      truncated: false,
      total: 2
    });
  });

  it("handles a deep linear tree iteratively and keeps the active node visible", () => {
    const depth = 20_000;
    const root = treeNode("node-0", null, "0");
    let parent = root;
    for (let index = 1; index < depth; index += 1) {
      const child = treeNode(`node-${index}`, parent.entry.id, String(index));
      parent.children.push(child);
      parent = child;
    }

    const projection = projectSessionTree(treeSource([root], parent.entry.id));

    expect(projection.total).toBe(depth);
    expect(projection.truncated).toBe(true);
    expect(projection.nodes.length).toBeLessThanOrEqual(MAX_TREE_NODES);
    expect(projection.nodes.at(-1)).toMatchObject({ id: parent.entry.id, active: true, depth: depth - 1 });
  });

  it("bounds a wide tree by node count without losing an early active node", () => {
    const roots = Array.from({ length: MAX_TREE_NODES + 200 }, (_, index) => treeNode(`root-${index}`, null, `${index}`));

    const projection = projectSessionTree(treeSource(roots, "root-0"));

    expect(projection.total).toBe(roots.length);
    expect(projection.nodes).toHaveLength(MAX_TREE_NODES);
    expect(projection.nodes[0]).toMatchObject({ id: "root-0", active: true, depth: 0 });
    expect(projection.truncated).toBe(true);
  });

  it("fits high-entropy labels and previews within the tree JSON budget", () => {
    const content = "中\"\\\n".repeat(400);
    const roots = Array.from({ length: MAX_TREE_NODES }, (_, index) => {
      const node = treeNode(`root-${index}`, null, content);
      node.label = content;
      return node;
    });

    const projection = projectSessionTree(treeSource(roots, roots.at(-1)?.entry.id ?? null));

    expect(Buffer.byteLength(JSON.stringify(projection), "utf8")).toBeLessThanOrEqual(MAX_TREE_JSON_BYTES);
    expect(projection.nodes.length).toBeLessThan(MAX_TREE_NODES);
    expect(projection.nodes.some((node) => node.active)).toBe(true);
    expect(projection.truncated).toBe(true);
  });
});

function treeNode(id: string, parentId: string | null, content: string): TestTreeNode {
  return {
    entry: {
      id,
      parentId,
      type: "message",
      timestamp: "2026-07-24T00:00:00.000Z",
      message: { role: "user", content, timestamp: 0 }
    },
    children: []
  };
}

function internalMarker(id: string, parentId: string | null): TestTreeNode {
  return {
    entry: {
      id,
      parentId,
      type: "custom",
      timestamp: "2026-07-24T00:00:00.000Z",
      customType: "pi67.session-creation",
      data: { schemaVersion: 1, creationId: "session-creation-test" }
    },
    children: []
  };
}

function treeSource(roots: TestTreeNode[], leafId: string | null): Pick<SessionManager, "getLeafId" | "getTree"> {
  return {
    getLeafId: () => leafId,
    getTree: () => roots as unknown as ReturnType<SessionManager["getTree"]>
  };
}
