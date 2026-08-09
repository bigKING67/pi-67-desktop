import type { ContextFileSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  contextFileStatusLabel,
  globalRuleGroups,
  presentItemCount,
  projectRuleGroups
} from "./RuleSettingsCatalog.js";

describe("rule settings catalog groups", () => {
  it("keeps creation candidates visible without counting them as configured files", () => {
    const items = [
      contextItem("managed-rule", "managed-rule", "managed", "present"),
      contextItem("global-rules", "rules-context", "global", "present"),
      contextItem("global-system", "system-prompt", "global", "missing"),
      contextItem("global-append", "append-system-prompt", "global", "missing"),
      contextItem("project-rules", "rules-context", "project", "present"),
      contextItem("inherited-rules", "rules-context", "inherited", "present"),
      contextItem("project-system", "system-prompt", "project", "missing"),
      contextItem("project-append", "append-system-prompt", "project", "missing")
    ];

    const global = globalRuleGroups(items);
    expect(global.rules).toHaveLength(1);
    expect(global.managed).toHaveLength(1);
    expect(global.system).toHaveLength(2);
    expect(presentItemCount(global.system)).toBe(0);

    const project = projectRuleGroups(items);
    expect(project.rules).toHaveLength(1);
    expect(project.inherited).toHaveLength(2);
    expect(project.system).toHaveLength(2);
    expect(presentItemCount(project.system)).toBe(0);
  });

  it("distinguishes missing, active, and overridden files in user-facing status", () => {
    expect(contextFileStatusLabel(contextItem("missing", "system-prompt", "global", "missing")))
      .toBe("尚未创建");
    expect(contextFileStatusLabel(contextItem("active", "rules-context", "global", "present")))
      .toBe("当前生效");
    expect(contextFileStatusLabel({
      ...contextItem("overridden", "system-prompt", "global", "present"),
      runtimeState: "overridden"
    })).toBe("已配置 · 当前未生效");
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
