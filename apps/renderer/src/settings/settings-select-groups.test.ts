import { describe, expect, it } from "vitest";
import { groupSelectOptions } from "./SettingsPrimitives.js";

describe("groupSelectOptions", () => {
  it("keeps ungrouped options flat and groups consecutive sections in source order", () => {
    const groups = groupSelectOptions([
      { id: "", label: "—" },
      { id: "dm:a", label: "A", section: "同事" },
      { id: "dm:b", label: "B", section: "同事" },
      { id: "c:1", label: "#x", section: "频道" }
    ]);
    expect(groups.map((group) => [group.section, group.options.map((option) => option.id)])).toEqual([
      [undefined, [""]],
      ["同事", ["dm:a", "dm:b"]],
      ["频道", ["c:1"]]
    ]);
  });
});
