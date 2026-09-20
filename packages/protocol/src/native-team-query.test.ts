import { expect, it } from "vitest";
import { isNativeTeamQuery, isNativeTeamQueryResult } from "./native-team-query.js";
const hit = { assetId: "00000000-0000-4000-8000-000000000001", score: 0.5 };
const request = { schema: "newmoney.team-vector-query.v1", scopeKey: "a".repeat(64), assetIds: [hit.assetId], vector: [0, 1, 0, 0], limit: 4 };
it("accepts only bounded vector input and metadata-only native results", () => {
  expect(isNativeTeamQuery(request)).toBe(true);
  expect(isNativeTeamQueryResult({ schema: "newmoney.team-vector-result.v1", hits: [hit] })).toBe(true);
  expect(isNativeTeamQueryResult({ schema: "newmoney.team-vector-result.v1", hits: [] })).toBe(true);
});
it.each([
  { vector: [] }, { vector: [1, 2, 3, 4, 5] }, { vector: Array(4100).fill(1) }, { vector: [Infinity, 0, 0, 0] },
  { vector: [NaN, 0, 0, 0] }, { vector: [1e39, 0, 0, 0] }, { vector: [true, 0, 0, 0] }, { limit: 0 }, { limit: 101 },
  { limit: 1.5 }, { scopeKey: "../private" }, { prompt: "never on this channel" }, { assetIds: [] },
  { assetIds: [hit.assetId, hit.assetId] }, { assetIds: ["../private"] }
])("rejects malformed request %j", changes => { expect(isNativeTeamQuery({ ...request, ...changes })).toBe(false); });
it.each([[hit, hit], [{ ...hit, score: Infinity }], [{ ...hit, score: NaN }], [{ ...hit, assetId: "../private" }],
  [{ ...hit, body: "not permitted" }], Array(101).fill(hit)])("rejects invalid result set %j", (...hits) => {
  expect(isNativeTeamQueryResult({ schema: "newmoney.team-vector-result.v1", hits })).toBe(false);
});
