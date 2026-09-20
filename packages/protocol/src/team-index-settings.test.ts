import { expect, it } from "vitest";
import { isTeamIndexSettingsMessage, isTeamIndexSettingsRequest } from "./team-index-settings.js";
const requestId = "00000000-0000-4000-8000-000000000001";
const settings = { extraction: { provider: "fixture", model: "extract" }, embedding: {
  protocol: "openai-compatible", endpoint: "https://model.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-key"
} };
it("admits only private correlation requests and bounded result/invalidation envelopes", () => {
  for (const type of ["team-index-settings-read", "team-index-settings-cancel"]) {
    expect(isTeamIndexSettingsRequest({ type, requestId })).toBe(true);
    expect(isTeamIndexSettingsRequest({ type, requestId, path: "/private" })).toBe(false);
    expect(isTeamIndexSettingsRequest({ type, requestId: "bad" })).toBe(false);
  }
  expect(isTeamIndexSettingsMessage({ type: "team-index-settings-result", requestId, ok: true, settings })).toBe(true);
  expect(isTeamIndexSettingsMessage({ type: "team-index-settings-result", requestId, ok: false, errorCode: "BUSY" })).toBe(true);
  expect(isTeamIndexSettingsMessage({ type: "team-index-settings-invalidated" })).toBe(true);
  expect(isTeamIndexSettingsMessage({ type: "team-index-settings-invalidated", settings })).toBe(false);
});
it.each([{ dimension: 6 }, { dimension: 65536 }, { endpoint: "http://127.0.0.1:8000" },
  { endpoint: "https://user:pass@model.invalid" }, { endpoint: "https://model.invalid?key=value" },
  { endpoint: "https://model.invalid#hash" }, { endpoint: "https://model.invalid\\v1" },
  { endpoint: "not-url" }, { model: "has space" }, { model: "x".repeat(129) },
  { apiKey: "key\r\nheader" }, { apiKey: "x".repeat(4097) }, { arbitrary: true }])("rejects incompatible/extra embedding fields %#", change => {
  expect(isTeamIndexSettingsMessage({ type: "team-index-settings-result", requestId, ok: true,
    settings: { ...settings, embedding: { ...settings.embedding, ...change } } })).toBe(false);
});
it.each([{ provider: " " }, { model: "x\0y" }, { apiKey: "must-not-copy-Pi-key" }])("rejects invalid extraction selection %#", change => {
  expect(isTeamIndexSettingsMessage({ type: "team-index-settings-result", requestId, ok: true,
    settings: { ...settings, extraction: { ...settings.extraction, ...change } } })).toBe(false);
});
