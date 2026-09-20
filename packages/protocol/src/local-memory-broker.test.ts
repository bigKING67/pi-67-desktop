import { describe, expect, it } from "vitest";
import { isLocalMemoryConnectRequest } from "./local-memory-broker.js";

describe("private connection request modes", () => {
  it("admits only default startup or explicit observation, never caller transport overrides", () => {
    const request = { type: "local-memory-connect", requestId: "request" };
    expect(isLocalMemoryConnectRequest(request)).toBe(true);
    expect(isLocalMemoryConnectRequest({ ...request, start: false })).toBe(true);
    for (const addition of [{ start: true }, { start: "false" }, { endpoint: "http://127.0.0.1:1933" }, { apiKey: "key" }]) {
      expect(isLocalMemoryConnectRequest({ ...request, ...addition })).toBe(false);
    }
  });
});
