import type { EnterpriseTeamSummary } from "@pi67/domain";
import { expect, it } from "vitest";
import { enterpriseTeamDescription } from "./ContextMemorySettingsPresentation.js";

const team: EnterpriseTeamSummary = {
  id: "team", name: "sixseven", role: "owner", entitlementStatus: "active",
  planCode: "team-internal", maxMembers: 5, memberCount: 6, projectCount: 0
};

it("shows internal unlimited membership only from explicit server metadata", () => {
  expect(enterpriseTeamDescription({ ...team, quotasExempt: true }))
    .toBe("所有者 · 6 人 · 不限额 · 内部自用");
  expect(enterpriseTeamDescription({ ...team, name: "Another team", quotasExempt: true }))
    .toBe("所有者 · 6 人 · 不限额 · 内部自用");
  for (const extra of [{}, { quotasExempt: false }]) {
    expect(enterpriseTeamDescription({ ...team, ...extra })).toBe("所有者 · 6/5 人 · 已启用");
  }
});

it.each([
  ["trialing", "试用中"], ["past_due", "待续费"], ["suspended", "已暂停"], ["expired", "已到期"]
] as const)("does not hide %s behind quota exemption", (entitlementStatus, label) => {
  expect(enterpriseTeamDescription({ ...team, quotasExempt: true, entitlementStatus }))
    .toBe(`所有者 · 6 人 · 不限额 · ${label}`);
});

it("preserves ordinary trial and role display", () => {
  expect(enterpriseTeamDescription({
    ...team, planCode: "team-trial", entitlementStatus: "trialing", role: "viewer", memberCount: 1
  })).toBe("只读成员 · 1/5 人 · 试用中");
});
