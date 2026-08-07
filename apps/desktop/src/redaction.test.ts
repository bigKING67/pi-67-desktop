import { describe, expect, it } from "vitest";
import { redact } from "./redaction.js";

describe("desktop redaction", () => {
  it("removes common credential shapes without changing ordinary errors", () => {
    const input = [
      "api_key=provider-secret-value",
      '"accessToken":"oauth-secret"',
      "Authorization: Bearer abc.def-123",
      "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "Cookie: session=private-cookie; theme=dark",
      "Set-Cookie: refresh=private-refresh",
      "https://example.invalid/callback?access_token=query-secret&next=safe",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      "ordinary runtime error"
    ].join("\n");
    const output = redact(input);

    expect(output).not.toContain("provider-secret-value");
    expect(output).not.toContain("oauth-secret");
    expect(output).not.toContain("abc.def-123");
    expect(output).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(output).not.toContain("private-cookie");
    expect(output).not.toContain("private-refresh");
    expect(output).not.toContain("query-secret");
    expect(output).toContain("next=safe");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(output).toContain("ordinary runtime error");
  });
});
