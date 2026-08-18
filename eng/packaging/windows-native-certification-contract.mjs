import { candidateBindingsMatch } from "./windows-native-candidate-binding.mjs";
import { WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX } from "./windows-layout-observation.mjs";

export const WINDOWS_NATIVE_CERTIFICATION_SCALES = [1.25, 1.5, 2];

export function validateWindowsNativeCertificationReceipts(
  receipts,
  expectedArtifact,
  expectedCandidate
) {
  const failures = [];
  if (!Array.isArray(receipts) || receipts.length !== WINDOWS_NATIVE_CERTIFICATION_SCALES.length) {
    return ["expected exactly three Windows native certification receipts"];
  }
  const executableHashes = new Set();
  const executableByteLengths = new Set();
  const signerThumbprints = new Set();
  const hostIdentities = new Set();
  let sleepObserved = false;
  for (const scale of WINDOWS_NATIVE_CERTIFICATION_SCALES) {
    const receipt = receipts.find((item) => item?.expectedScale === scale);
    const label = `${Math.round(scale * 100)}%`;
    if (!receipt) {
      failures.push(`${label}: receipt is missing`);
      continue;
    }
    if (receipt.status !== "passed" || receipt.evidenceLevel !== "interactive-windows-native-runtime") {
      failures.push(`${label}: receipt status or evidence level is invalid`);
    }
    if (receipt.coldStartedAtExpectedScale !== true) {
      failures.push(`${label}: application was not cold-started at the certified scale`);
    }
    if (receipt.host?.platform !== "win32" || receipt.host?.arch !== "x64") {
      failures.push(`${label}: host is not Windows x64`);
    }
    if (!/^[a-f0-9]{64}$/u.test(receipt.host?.idSha256 ?? "")) {
      failures.push(`${label}: hashed Windows host identity is invalid`);
    } else {
      hostIdentities.add(receipt.host.idSha256);
    }
    if (!Number.isSafeInteger(receipt.artifact?.byteLength) || receipt.artifact.byteLength < 1) {
      failures.push(`${label}: executable byte length is invalid`);
    } else {
      executableByteLengths.add(receipt.artifact.byteLength);
    }
    if (!/^[a-f0-9]{64}$/u.test(receipt.artifact?.sha256 ?? "")) {
      failures.push(`${label}: executable SHA-256 is invalid`);
    } else {
      executableHashes.add(receipt.artifact.sha256);
    }
    if (receipt.artifact?.authenticode?.status !== "Valid"
      || !/^[A-F0-9]{40}$/u.test(receipt.artifact?.authenticode?.signerThumbprint ?? "")) {
      failures.push(`${label}: Authenticode identity is invalid`);
    } else {
      signerThumbprints.add(receipt.artifact.authenticode.signerThumbprint);
    }
    if (expectedArtifact) {
      if (receipt.artifact?.byteLength !== expectedArtifact.byteLength
        || receipt.artifact?.sha256 !== expectedArtifact.sha256) {
        failures.push(`${label}: receipt does not match the verified executable bytes`);
      }
      if (receipt.artifact?.authenticode?.signerThumbprint
        !== expectedArtifact.authenticode?.signerThumbprint) {
        failures.push(`${label}: receipt does not match the expected Windows Publisher`);
      }
    }
    if (expectedCandidate && !candidateBindingsMatch(receipt.candidate, expectedCandidate)) {
      failures.push(`${label}: receipt does not match the signed release candidate identity`);
    }
    if (!matchesScale(receipt.nativeRuntime?.main?.displayScaleFactor, scale)
      || !matchesScale(receipt.nativeRuntime?.renderer?.devicePixelRatio, scale)) {
      failures.push(`${label}: native display scale or renderer DPR does not match`);
    }
    if (receipt.ime?.candidateConfirmation?.isTrusted !== true
      || !(receipt.ime.candidateConfirmation.isComposing || receipt.ime.candidateConfirmation.keyCode === 229)
      || receipt.ime?.secondEnter?.isTrusted !== true
      || receipt.ime.secondEnter.isComposing
      || receipt.ime.secondEnter.keyCode === 229
      || receipt.ime.acceptedExactlyOnce !== true
      || receipt.ime.delivery !== "follow-up"
      || receipt.ime.operationIdMatches !== true
      || receipt.ime.composerClearedAfterAccepted !== true
      || !/^[a-f0-9]{64}$/u.test(receipt.ime.acceptedTextSha256 ?? "")) {
      failures.push(`${label}: trusted Microsoft Pinyin confirmation and exactly-once submission are missing`);
    }
    validateResponsiveReceipt(
      receipt.responsive?.contextViewport,
      scale,
      WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
      `${label} context`,
      failures
    );
    validateResponsiveReceipt(receipt.responsive?.navigationViewport, scale, 760, `${label} navigation`, failures);
    if (receipt.sleep?.observed === true) {
      sleepObserved = true;
      if (!Number.isFinite(receipt.sleep.suspendAt)
        || !Number.isFinite(receipt.sleep.resumeAt)
        || receipt.sleep.resumeAt <= receipt.sleep.suspendAt
        || receipt.sleep.sleepGapMs < 1_000
        || receipt.sleep.projectionRecovered !== true
        || receipt.sleep.operationStillActive !== true) {
        failures.push(`${label}: native suspend/resume evidence is invalid`);
      }
    }
    if (receipt.shutdown?.controlledChildExited !== true
      || receipt.shutdown?.closeDurationMs > 5_000
      || receipt.shutdown?.utilityProcessCount < 1) {
      failures.push(`${label}: bounded shutdown evidence is invalid`);
    }
  }
  if (executableHashes.size !== 1) failures.push("all DPI receipts must certify the same executable SHA-256");
  if (executableByteLengths.size !== 1) failures.push("all DPI receipts must certify the same executable byte length");
  if (signerThumbprints.size !== 1) failures.push("all DPI receipts must certify the same Authenticode signer");
  if (hostIdentities.size !== 1) failures.push("all DPI receipts must come from the same Windows host identity");
  if (!sleepObserved) failures.push("at least one scale receipt must include a real sleep/resume observation");
  return failures;
}

function validateResponsiveReceipt(value, scale, expectedWidth, label, failures) {
  if (!value || !matchesScale(value.devicePixelRatio, scale) || Math.abs(value.innerWidth - expectedWidth) > 1) {
    failures.push(`${label}: viewport or DPR is invalid`);
    return;
  }
  if (value.horizontalOverflow > 1
    || !value.send?.contained
    || !value.send?.topmost
    || !value.stop?.contained
    || !value.stop?.topmost
    || value.titleBarNativeControlReserve < 136) {
    failures.push(`${label}: responsive controls are clipped, covered, or overlap native controls`);
  }
}

function matchesScale(actual, expected) {
  return typeof actual === "number" && Math.abs(actual - expected) <= 0.05;
}
