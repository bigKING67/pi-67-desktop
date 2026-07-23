import { describe, expect, it } from "vitest";
import { redact } from "./redaction.js";

describe("desktop redaction", () => {
  it("removes common credential shapes without changing ordinary errors", () => {
    const input = [
      "api_key=provider-secret-value",
      '"accessToken":"oauth-secret"',
      "Authorization: Bearer abc.def-123",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      "ordinary runtime error"
    ].join("\n");
    const output = redact(input);

    expect(output).not.toContain("provider-secret-value");
    expect(output).not.toContain("oauth-secret");
    expect(output).not.toContain("abc.def-123");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(output).toContain("ordinary runtime error");
  });
});
