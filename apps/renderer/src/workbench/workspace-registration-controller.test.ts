import { describe, expect, it } from "vitest";
import { workspaceOrderAfterDrop } from "./workspace-registration-controller.js";

describe("workspace registration controller", () => {
  it("moves a dragged workspace across the drop target without losing ids", () => {
    expect(workspaceOrderAfterDrop(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(workspaceOrderAfterDrop(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("ignores missing ids and a drop onto the same workspace", () => {
    expect(workspaceOrderAfterDrop(["a", "b"], "a", "a")).toBeUndefined();
    expect(workspaceOrderAfterDrop(["a", "b"], "missing", "b")).toBeUndefined();
  });
});
