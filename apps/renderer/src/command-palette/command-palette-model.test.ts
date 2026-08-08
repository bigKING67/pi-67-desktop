import { Command } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  buildPaletteProjection,
  MAX_VISIBLE_SEARCH_RESULTS,
  type PaletteAction
} from "./command-palette-model.js";

describe("command palette model", () => {
  it("groups the default view without mounting an unbounded session list", () => {
    const projection = buildPaletteProjection(
      Array.from({ length: 40 }, (_, index) => action(`session:${index}`, "sessions", `Session ${index}`)),
      ""
    );

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0]?.label).toBe("会话");
    expect(projection.groups[0]?.items).toHaveLength(12);
    expect(projection).toMatchObject({ totalMatchCount: 40, visibleMatchCount: 12, truncated: true });
  });

  it("keeps the complete bounded first-party action registry in the default view", () => {
    const projection = buildPaletteProjection(
      Array.from({ length: 17 }, (_, index) => action(`action:${index}`, "actions", `Action ${index}`)),
      ""
    );

    expect(projection.groups[0]?.items).toHaveLength(17);
    expect(projection).toMatchObject({ totalMatchCount: 17, visibleMatchCount: 17, truncated: false });
  });

  it("supports bounded subsequence matching and keeps category grouping", () => {
    const actions = [
      action("settings:provider", "settings", "Provider 与凭据", "authentication api key"),
      action("session:protocol", "sessions", "重构协议层", "protocol v2")
    ];

    const projection = buildPaletteProjection(actions, "prvdr");

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0]?.id).toBe("settings");
    expect(projection.groups[0]?.items.map((item) => item.id)).toEqual(["settings:provider"]);
  });

  it("places local message-body results directly after matching Sessions", () => {
    const projection = buildPaletteProjection([
      action("settings:search", "settings", "Search settings"),
      action("message:search", "messages", "Search message"),
      action("session:search", "sessions", "Search session"),
      action("action:search", "actions", "Search action")
    ], "search");
    expect(projection.groups.map((group) => group.id)).toEqual([
      "sessions",
      "messages",
      "actions",
      "settings"
    ]);
    expect(buildPaletteProjection([
      action("message:search", "messages", "Search message")
    ], "").groups).toEqual([]);
  });

  it("reports exact search truncation instead of inferring it from all actions", () => {
    const exactlyVisible = buildPaletteProjection(
      Array.from({ length: MAX_VISIBLE_SEARCH_RESULTS }, (_, index) => (
        action(`session:search-${index}`, "sessions", `Search Session ${index}`)
      )),
      "search"
    );
    const truncated = buildPaletteProjection(
      Array.from({ length: MAX_VISIBLE_SEARCH_RESULTS + 1 }, (_, index) => (
        action(`session:search-${index}`, "sessions", `Search Session ${index}`)
      )),
      "search"
    );

    expect(exactlyVisible).toMatchObject({
      totalMatchCount: MAX_VISIBLE_SEARCH_RESULTS,
      visibleMatchCount: MAX_VISIBLE_SEARCH_RESULTS,
      truncated: false
    });
    expect(truncated).toMatchObject({
      totalMatchCount: MAX_VISIBLE_SEARCH_RESULTS + 1,
      visibleMatchCount: MAX_VISIBLE_SEARCH_RESULTS,
      truncated: true
    });
  });

  it("projects recent actions without duplicating their normal group", () => {
    const recent = action("settings:recent-test", "settings", "Recent Test");
    const projection = buildPaletteProjection(
      [recent, action("action:other", "actions", "Other")],
      "",
      [recent.id]
    );

    expect(projection.groups[0]?.id).toBe("recent");
    expect(projection.groups[0]?.items.map((item) => item.id)).toEqual([recent.id]);
    expect(projection.groups.flatMap((group) => group.items).filter((item) => item.id === recent.id)).toHaveLength(1);
  });
});

function action(
  id: string,
  group: PaletteAction["group"],
  label: string,
  keywords = ""
): PaletteAction {
  return {
    id,
    group,
    label,
    detail: label,
    keywords,
    icon: Command,
    run: () => undefined
  };
}
