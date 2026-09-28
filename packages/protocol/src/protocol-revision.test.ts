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

  it("covers the tables that gate envelope acceptance", () => {
    const acceptance = JSON.parse(canonicalProtocolRevisionMaterial()).acceptance;
    expect(acceptance.commandContextScope["workspace.register"]).toBe("workspace");
    expect(acceptance.eventContext["runtime.ready"]).toEqual({ session: true, operation: false });
    expect(acceptance.replaySafeControlMutations).toContain("runtime.initialize");
    expect(acceptance.replaySafeOperationAcks).toContain("session.compact");
  });
});
