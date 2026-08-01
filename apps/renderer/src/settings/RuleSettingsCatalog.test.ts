import type { ContextFileSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  globalRuleCategoryDefinitions,
  projectRuleCategoryDefinitions
} from "./RuleSettingsCatalog.js";

describe("rule settings catalog categories", () => {
  it("separates global and project resources into counted flat catalogs", () => {
    const items = [
      contextItem("managed", "managed-rule", "managed", "present"),
      contextItem("global-rules", "rules-context", "global", "present"),
      contextItem("global-system", "system-prompt", "global", "missing"),
      contextItem("global-append", "append-system-prompt", "global", "missing"),
      contextItem("project-rules", "rules-context", "project", "present"),
      contextItem("inherited-rules", "rules-context", "inherited", "present"),
      contextItem("project-system", "system-prompt", "project", "missing"),
      contextItem("project-append", "append-system-prompt", "project", "missing")
    ];

    expect(globalRuleCategoryDefinitions(items).map((category) => ({
      id: category.id,
      label: category.label,
      count: category.items.length
    }))).toEqual([
      { id: "rules", label: "全局规则", count: 1 },
      { id: "managed", label: "桌面托管", count: 1 },
      { id: "system", label: "系统提示词", count: 2 }
    ]);
    expect(projectRuleCategoryDefinitions(items, "demo").map((category) => ({
      id: category.id,
      label: category.label,
      count: category.items.length
    }))).toEqual([
      { id: "rules", label: "项目规则", count: 1 },
      { id: "inherited", label: "继承规则", count: 2 },
      { id: "system", label: "系统提示词", count: 2 }
    ]);
  });
});

function contextItem(
  suffix: string,
  category: ContextFileSummary["category"],
  scope: ContextFileSummary["scope"],
  presence: ContextFileSummary["presence"]
): ContextFileSummary {
  return {
    id: `ctx_${suffix.padEnd(64, "0")}`,
    name: `${suffix}.md`,
    path: `/fixture/${suffix}.md`,
    category,
    scope,
    origin: scope === "managed" ? "desktop" : scope === "project" ? "workspace" : scope === "inherited" ? "ancestor" : "user",
    presence,
    access: presence === "missing" ? "creatable" : scope === "managed" || scope === "inherited" ? "read-only" : "editable",
    runtimeState: presence === "missing" ? "not-loaded" : "active"
  };
}
