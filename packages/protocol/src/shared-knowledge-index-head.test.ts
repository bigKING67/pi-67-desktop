import { expect, it } from "vitest";
import { isSharedKnowledgeIndexHeadRequest as request, isSharedKnowledgeIndexHeadResult as result } from "./shared-knowledge-receipt-broker.js";

const id = "00000000-0000-4000-8000-000000000001";
const check = () => ({ type: "team-index-head-check", requestId: id, owner: { userId: "user", endpoint: "https://service.invalid", teamId: id, scopeKind: "team", scopeId: id },
  models: { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } },
  snapshot: { epoch: id, cursor: "9007199254740993" }, permissionRevision: "a".repeat(64) });
it("accepts only bounded metadata and exact cancellation/results", () => {
  expect(request(check())).toBe(true);
  expect(request({ type: "team-index-head-cancel", requestId: id })).toBe(true);
  expect(result({ type: "team-index-head-result", requestId: id, ok: true, validUntil: Date.now() + 60_000 })).toBe(true);
  expect(result({ type: "team-index-head-result", requestId: id, ok: false })).toBe(true);
  expect(result({ type: "team-index-head-invalidated", requestId: id })).toBe(true);
});
it.each(["path", "token", "localProfileId", "body"])("rejects %s fields at both request and owner boundaries", field => {
  expect(request({ ...check(), [field]: "synthetic" })).toBe(false);
  expect(request({ ...check(), owner: { ...check().owner, [field]: "synthetic" } })).toBe(false);
  expect(result({ type: "team-index-head-result", requestId: id, ok: false, [field]: "synthetic" })).toBe(false);
});
it.each(["0", "9223372036854775808", "01", "-1", "1.1"])("rejects invalid snapshot cursor %s", cursor => {
  expect(request({ ...check(), snapshot: { epoch: id, cursor } })).toBe(false);
});
it.each(["http://service.invalid", "https://user:pass@service.invalid", "https://service.invalid?secret=synthetic", "https://service.invalid/#frag", " https://service.invalid", "invalid"])("rejects invalid endpoint %s", endpoint => {
  const value = check(); value.owner.endpoint = endpoint; expect(request(value)).toBe(false);
});
it("refuses mismatched team scope, null epoch, malformed revision and invalid model selection", () => {
  const value = check(); value.owner.scopeId = "00000000-0000-4000-8000-000000000002"; expect(request(value)).toBe(false);
  value.owner.scopeKind = "project"; expect(request(value)).toBe(true);
  expect(request({ ...check(), snapshot: { epoch: null, cursor: "1" } })).toBe(false);
  expect(request({ ...check(), permissionRevision: "revision" })).toBe(false);
  const invalid = check(); invalid.models.embedding.dimension = 3; expect(request(invalid)).toBe(false);
  invalid.models.embedding.dimension = 4; invalid.models.extraction.model = "two words"; expect(request(invalid)).toBe(false);
});
it.each([0, -1, 1.5, Infinity, 8_640_000_000_000_001])("rejects invalid result deadline %s", validUntil => {
  expect(result({ type: "team-index-head-result", requestId: id, ok: true, validUntil })).toBe(false);
});
