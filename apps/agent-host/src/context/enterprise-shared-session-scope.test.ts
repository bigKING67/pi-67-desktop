import { expect, it } from "vitest";
import { assertSharedSessionScope } from "./enterprise-shared-session-scope.js";
const expected = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://fixture.invalid" };
it("accepts only the same user service team and project, without deriving identity from a model", () => {
  expect(() => assertSharedSessionScope({ scope: { ...expected, endpoint: "https://fixture.invalid/" } }, expected)).not.toThrow();
  for (const scope of [undefined, { ...expected, userId: "other" }, { ...expected, teamId: "other" },
    { ...expected, projectId: "other" }, { ...expected, endpoint: "https://other.invalid" },
    { ...expected, endpoint: "not-a-url" }]) {
    expect(() => assertSharedSessionScope(scope ? { scope } : {}, expected)).toThrow();
  }
  expect(() => assertSharedSessionScope(undefined, expected)).not.toThrow();
});
