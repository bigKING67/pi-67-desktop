import { describe, expect, it } from "vitest";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  matchesSettingsQuery,
  sectionSupportsProjectScope
} from "./settings-navigation.js";

describe("settings navigation", () => {
  it("uses concise Chinese labels and keeps prompts separate from rules", () => {
    expect(SETTINGS_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.map(({ id, label }) => ({ id, label }))
    }))).toEqual([
      { label: "个人", items: [{ id: "account", label: "账户" }] },
      { label: "应用", items: [{ id: "general", label: "通用" }] },
      {
        label: "Pi",
        items: [
          { id: "providers", label: "模型服务" },
          { id: "extensions", label: "扩展" },
          { id: "skills", label: "技能" },
          { id: "prompts", label: "指令模板" },
          { id: "rules", label: "规则与上下文" },
          { id: "integrations", label: "集成" },
          { id: "runtime", label: "运行服务" },
          { id: "network", label: "下载源与网络" }
        ]
      },
      {
        label: "支持",
        items: [
          { id: "updates", label: "更新与诊断" },
          { id: "about", label: "关于" }
        ]
      }
    ]);
  });

  it("keeps every category in the shared Settings document flow", () => {
    expect(SETTINGS_SECTIONS).toHaveLength(12);
    expect(SETTINGS_SECTIONS.every((item) => !("layout" in item))).toBe(true);
  });

  it("keeps English technical aliases searchable without exposing them as labels", () => {
    const items = SETTINGS_GROUPS.flatMap((group) => group.items);
    const provider = items.find((item) => item.id === "providers");
    const extension = items.find((item) => item.id === "extensions");
    const prompt = items.find((item) => item.id === "prompts");
    const rule = items.find((item) => item.id === "rules");
    const runtime = items.find((item) => item.id === "runtime");

    expect(provider && matchesSettingsQuery(provider, "provider")).toBe(true);
    expect(extension && matchesSettingsQuery(extension, "extension")).toBe(true);
    expect(extension && matchesSettingsQuery(extension, "扩展包")).toBe(true);
    expect(extension && matchesSettingsQuery(extension, "本地扩展")).toBe(true);
    const skill = items.find((item) => item.id === "skills");
    expect(skill && matchesSettingsQuery(skill, "内置技能")).toBe(true);
    expect(skill && matchesSettingsQuery(skill, "全局可用")).toBe(true);
    expect(skill && matchesSettingsQuery(skill, "项目专属")).toBe(true);
    expect(skill && matchesSettingsQuery(skill, ".agents/skills")).toBe(true);
    expect(sectionSupportsProjectScope("skills")).toBe(false);
    expect(prompt && matchesSettingsQuery(prompt, "prompts")).toBe(true);
    expect(rule && matchesSettingsQuery(rule, "rules")).toBe(true);
    expect(runtime && matchesSettingsQuery(runtime, "session")).toBe(true);
    expect(sectionSupportsProjectScope("prompts")).toBe(true);
    expect(sectionSupportsProjectScope("rules")).toBe(false);
  });
});
