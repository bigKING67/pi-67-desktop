import type { RiskCategory, TaskToolMode, ToolAutoAuthorizationReason } from "@pi67/domain";
import { describe, expectTypeOf, it } from "vitest";
import { RiskCategorySchema, TaskToolModeSchema } from "./approval-schemas.js";
import { ToolAuthorizationProjectionSchema } from "./operation-schemas.js";
import type { Static } from "./typebox-schema.js";

// Checked by typecheck: adding a value on either side without the other fails the build, so the
// Host can never emit a value the renderer's envelope validation rejects.
describe("protocol literal unions mirror domain unions exactly", () => {
  it("covers risk categories, task tool modes and auto-authorization reasons", () => {
    expectTypeOf<Static<typeof RiskCategorySchema>>().toEqualTypeOf<RiskCategory>();
    expectTypeOf<Static<typeof TaskToolModeSchema>>().toEqualTypeOf<TaskToolMode>();
    expectTypeOf<Static<typeof ToolAuthorizationProjectionSchema>["reason"]>().toEqualTypeOf<ToolAutoAuthorizationReason>();
  });
});
