import { Value } from "typebox/value";
import { expect, it } from "vitest";
import { ContextMemoryCommandResultSchemas } from "./context-memory-schemas.js";

const team = {
  id: "team", name: "sixseven", role: "owner", entitlementStatus: "active",
  planCode: "team-internal", maxMembers: 5, memberCount: 6, projectCount: 0
};
const schema = ContextMemoryCommandResultSchemas["enterprise.team.list"];

it("accepts absent, false and true commercial quota metadata in team list results", () => {
  for (const extra of [{}, { quotasExempt: false }, { quotasExempt: true }]) {
    expect(Value.Check(schema, { items: [{ ...team, ...extra }], total: 1 })).toBe(true);
  }
});

it("rejects non-boolean exemptions and retains the existing strict result boundary", () => {
  for (const quotasExempt of [null, "true", "false", 0, 1, {}, []]) {
    expect(Value.Check(schema, { items: [{ ...team, quotasExempt }], total: 1 })).toBe(false);
  }
  for (const extra of [{ role: "root" }, { entitlementStatus: "unlimited" }, { maxMembers: 0 }, { accessToken: "fixture" }]) {
    expect(Value.Check(schema, { items: [{ ...team, quotasExempt: true, ...extra }], total: 1 })).toBe(false);
  }
});
