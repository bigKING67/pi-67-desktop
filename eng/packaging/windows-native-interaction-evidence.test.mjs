import { describe, expect, it } from "vitest";
import {
  validateNativePowerResumeEvidence,
  validateTrustedImeSubmissionEvidence
} from "./windows-native-interaction-evidence.mjs";

describe("Windows native interaction evidence", () => {
  it("requires candidate confirmation followed by one trusted accepted Enter", () => {
    const evidence = validateTrustedImeSubmissionEvidence({
      composerValue: "",
      eventsBeforeSecondEnter: 1,
      events: [
        { isComposing: true, isTrusted: true, keyCode: 229 },
        { isComposing: false, isTrusted: true, keyCode: 13 }
      ],
      probe: {
        acceptedCount: 1,
        activeOperationId: "operation-1",
        delivery: "follow-up",
        operationIdMatches: true,
        requestCount: 1,
        responseCount: 1,
        textMatches: true
      }
    });
    expect(evidence.acceptedExactlyOnce).toBe(true);
    expect(evidence.composerClearedAfterAccepted).toBe(true);
  });

  it("rejects duplicate, synthetic, or unaccepted post-composition Enter", () => {
    const base = {
      composerValue: "",
      eventsBeforeSecondEnter: 1,
      events: [
        { isComposing: true, isTrusted: true, keyCode: 229 },
        { isComposing: false, isTrusted: false, keyCode: 13 }
      ],
      probe: {
        acceptedCount: 2,
        activeOperationId: "operation-1",
        delivery: "follow-up",
        operationIdMatches: true,
        requestCount: 2,
        responseCount: 2,
        textMatches: true
      }
    };
    expect(() => validateTrustedImeSubmissionEvidence(base)).toThrow("post-composition Enter");
  });

  it("requires an ordered real power gap and recovered Operation", () => {
    expect(validateNativePowerResumeEvidence({
      events: [{ type: "suspend", at: 2_000 }, { type: "resume", at: 8_000 }],
      markerStartedAt: 1_000,
      operationStillActive: true,
      projectionRecovered: true
    })).toMatchObject({ observed: true, sleepGapMs: 6_000 });
    expect(() => validateNativePowerResumeEvidence({
      events: [{ type: "resume", at: 8_000 }],
      markerStartedAt: 1_000,
      operationStillActive: true,
      projectionRecovered: true
    })).toThrow("ordered suspend/resume");
  });
});
