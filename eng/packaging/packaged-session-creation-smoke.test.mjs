import { expect, it } from "vitest";
import { assertPackagedTeamToolSelection } from "./packaged-session-creation-smoke.mjs";

const canonical = ["viking_team_search", "viking_team_read"];
const local = tools => ({ privateMode: "1", canonicalMode: "1", tools });

it("accepts exactly one canonical pair alongside unrelated Pi tools", () => {
  expect(() => assertPackagedTeamToolSelection(local(["read", ...canonical]), true)).not.toThrow();
});
it.each(["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read"])(
  "rejects leaked legacy tool %s in the packaged local route", name => {
    expect(() => assertPackagedTeamToolSelection(local([...canonical, name]), true)).toThrow("Tool selection");
  }
);
it.each([[], [canonical[0]], [...canonical, canonical[0]], null])("rejects missing, duplicate or invalid tool evidence %#", tools => {
  expect(() => assertPackagedTeamToolSelection(local(tools), true)).toThrow("Tool selection");
});
it.each([{ privateMode: "0" }, { canonicalMode: "0" }])("rejects changed Main mode %#", change => {
  expect(() => assertPackagedTeamToolSelection({ ...local(canonical), ...change }, true)).toThrow("Tool selection");
});
it("does not accidentally enable the canonical route on an unsupported platform", () => {
  const legacy = { privateMode: "0", canonicalMode: "0", tools: ["viking_shared_search", "viking_shared_read"] };
  expect(() => assertPackagedTeamToolSelection(legacy, false)).not.toThrow();
  expect(() => assertPackagedTeamToolSelection({ ...legacy, tools: canonical }, false)).toThrow("Tool selection");
});
