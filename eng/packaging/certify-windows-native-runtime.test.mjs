import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assertNativeScale,
  parseWindowsNativeCertificationArguments,
  WINDOWS_NATIVE_CERTIFICATION_SCALES
} from "./certify-windows-native-runtime.mjs";

const certifierUrl = new URL("./certify-windows-native-runtime.mjs", import.meta.url);

describe("Windows native certification contract", () => {
  it("accepts only release-bound real Windows display certifications", () => {
    const signer = "ab".repeat(20);
    for (const scale of WINDOWS_NATIVE_CERTIFICATION_SCALES) {
      expect(parseWindowsNativeCertificationArguments([
        "--expected-scale", String(scale),
        "--expected-signer-thumbprint", signer,
        ...candidateArguments()
      ])).toEqual(expectedArguments({ expectedScale: scale, signer }));
    }
    expect(parseWindowsNativeCertificationArguments([
      "--expected-scale", "1.5",
      "--sleep",
      "--executable", "C:\\Pi-67 Desktop.exe",
      "--expected-signer-thumbprint", signer,
      ...candidateArguments()
    ])).toEqual(expectedArguments({
      executablePath: "C:\\Pi-67 Desktop.exe",
      expectedScale: 1.5,
      signer,
      sleep: true
    }));
    expect(parseWindowsNativeCertificationArguments([
      "--expected-scale", "1.5",
      "--expected-signer-thumbprint", signer,
      "--interaction-mode", "workflow",
      ...candidateArguments()
    ])).toMatchObject({ interactionMode: "workflow" });
  });

  it("rejects unsupported scales, interaction modes, signer gaps, and unbound candidates", () => {
    const signer = "ab".repeat(20);
    expect(() => parseWindowsNativeCertificationArguments([
      "--expected-scale", "1",
      "--expected-signer-thumbprint", signer,
      ...candidateArguments()
    ])).toThrow("must be one of");
    expect(() => parseWindowsNativeCertificationArguments(["--expected-scale", "1.5", "--executable"]))
      .toThrow("requires a path");
    expect(() => parseWindowsNativeCertificationArguments([
      "--expected-scale", "1.5",
      ...candidateArguments()
    ])).toThrow("40 hexadecimal");
    expect(() => parseWindowsNativeCertificationArguments([
      "--expected-scale", "1.5",
      "--expected-signer-thumbprint", signer,
      "--interaction-mode", "automatic",
      ...candidateArguments()
    ])).toThrow("terminal or workflow");
    expect(() => parseWindowsNativeCertificationArguments([
      "--expected-scale", "1.5",
      "--expected-signer-thumbprint", signer
    ])).toThrow("--candidate-identity");
  });

  it("requires the Electron display and renderer DPR to match the real scale", () => {
    expect(() => assertNativeScale(runtime(1.5, 1.5), 1.5)).not.toThrow();
    expect(() => assertNativeScale(runtime(1.25, 1.5), 1.5)).toThrow("Electron display scale");
    expect(() => assertNativeScale(runtime(1.5, 2), 1.5)).toThrow("Renderer devicePixelRatio");
  });

  it("discards DPI probe shutdown evidence before launching the certified instance", async () => {
    const source = await readFile(certifierUrl, "utf8");
    const resetIndex = source.indexOf("await resetControlledShutdownLifecycle(lifecyclePath);");
    const finalLaunchIndex = source.indexOf(
      "({ application, page } = await launchCertificationApplication(artifact, directories));",
      resetIndex
    );
    const finalAssertionIndex = source.indexOf(
      "await assertSingleShutdownQuitLifecycle(lifecyclePath",
      finalLaunchIndex
    );

    expect(resetIndex).toBeGreaterThan(source.indexOf("await application.close();"));
    expect(finalLaunchIndex).toBeGreaterThan(resetIndex);
    expect(finalAssertionIndex).toBeGreaterThan(finalLaunchIndex);
    expect(source).not.toContain('lifecycle.includes("shutdown:quit")');
  });
});

function candidateArguments() {
  return [
    "--candidate-identity", "C:\\candidate.json",
    "--installer", "C:\\candidate-installer.exe",
    "--expected-repository", "bigKING67/pi-67-desktop",
    "--expected-source-tag", "v1.2.3",
    "--expected-source-commit", "a".repeat(40),
    "--expected-candidate-run-id", "123",
    "--expected-candidate-run-attempt", "1"
  ];
}

function expectedArguments({ executablePath, expectedScale, signer, sleep = false }) {
  return {
    candidateIdentityPath: "C:\\candidate.json",
    executablePath,
    expectedCandidateRunAttempt: "1",
    expectedCandidateRunId: "123",
    expectedRepository: "bigKING67/pi-67-desktop",
    expectedScale,
    expectedSignerThumbprint: signer.toUpperCase(),
    expectedSourceCommit: "a".repeat(40),
    expectedSourceTag: "v1.2.3",
    interactionMode: "terminal",
    installerPath: "C:\\candidate-installer.exe",
    sleep
  };
}

function runtime(displayScaleFactor, devicePixelRatio) {
  return {
    main: { displayScaleFactor },
    renderer: { devicePixelRatio }
  };
}
