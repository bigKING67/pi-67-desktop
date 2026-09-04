import { describe, expect, it } from "vitest";
import { redactAndRequireExperience } from "./experience-candidate-redaction.js";

describe("Experience candidate credential redaction", () => {
  it("removes entire synthetic credential values before a field can pass", () => {
    const value = redactAndRequireExperience(
      "Use Authorization: Bearer SYNTHETIC_TOKEN_1234567890 and api_key=SYNTHETIC_SECRET_1234567890",
      2_048,
      "strategy",
    );
    expect(value).toContain("[REDACTED_CREDENTIAL]");
    expect(value).not.toMatch(/SYNTHETIC_|bearer|api_key/iu);
  });

  it("rejects an unclassified high-entropy value instead of marking redaction passed", () => {
    const suspicious = `Use ${"Gz9".repeat(16)} for the request`;
    expect(() => redactAndRequireExperience(suspicious, 2_048, "strategy"))
      .toThrow("still contains a credential-like value after redaction");
  });

  it("keeps a content hash because it is evidence rather than a credential", () => {
    const hash = "a".repeat(64);
    expect(redactAndRequireExperience(`Evidence sha256 ${hash}`, 2_048, "evidence label"))
      .toContain(hash);
  });

  it("rejects an unlabeled long hex value rather than assuming it is evidence", () => {
    expect(() => redactAndRequireExperience(`Use ${"ab12".repeat(16)}`, 2_048, "strategy"))
      .toThrow("still contains a credential-like value after redaction");
  });
});
