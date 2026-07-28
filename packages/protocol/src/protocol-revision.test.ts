import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalProtocolRevisionMaterial } from "./protocol-revision-contract.js";
import { PROTOCOL_REVISION } from "./protocol-revision.js";

describe("protocol revision", () => {
  it("matches the canonical cross-process schema contract", () => {
    const computed = createHash("sha256")
      .update(canonicalProtocolRevisionMaterial(), "utf8")
      .digest("hex");
    expect(PROTOCOL_REVISION).toBe(computed);
  });
});
