import { describe, expect, it } from "vitest";
import { candidateBindingsMatch } from "./windows-native-candidate-binding.mjs";

describe("Windows native candidate binding", () => {
  it("requires the complete source, workflow, artifact, and signer identity", () => {
    const expected = binding();
    expect(candidateBindingsMatch(expected, expected)).toBe(true);
    expect(candidateBindingsMatch({
      ...expected,
      source: { ...expected.source, policy: "version-tag" }
    }, expected)).toBe(false);
    expect(candidateBindingsMatch({
      ...expected,
      workflow: { ...expected.workflow, runAttempt: "2" }
    }, expected)).toBe(false);
    expect(candidateBindingsMatch({
      ...expected,
      packagedExecutableSha256: "f".repeat(64)
    }, expected)).toBe(false);
  });
});

function binding() {
  return {
    identitySha256: "a".repeat(64),
    repository: "bigKING67/pi-67-desktop",
    source: { policy: "stable", tag: "v1.2.3", commit: "b".repeat(40) },
    workflow: { runId: "123", runAttempt: "1" },
    version: "1.2.3",
    installerSha256: "c".repeat(64),
    packagedExecutableSha256: "d".repeat(64),
    signerThumbprint: "E".repeat(40)
  };
}
