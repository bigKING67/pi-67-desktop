import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installSaveDialogResult } from "./packaged-electron-fixture.mjs";

export async function verifyPackagedMainOnlyDiagnostics(options) {
  const diagnosticsPath = join(options.userDataDirectory, "packaged-main-only-diagnostics.json");
  await installSaveDialogResult(options.application, diagnosticsPath);
  const savedPath = await options.window.evaluate(() => window.pi67.system.saveDiagnostics({
    runtimeCollection: {
      status: "unavailable",
      failure: "connection-unavailable"
    },
    renderer: {
      activeRequestCount: 0,
      sampleCount: 0,
      slowAcknowledgementCount: 0,
      slowThresholdMs: 2_000
    }
  }));
  if (savedPath !== diagnosticsPath) {
    throw new Error(`Packaged Main-only diagnostics saved to an unexpected path: ${String(savedPath)}`);
  }
  const text = await readFile(diagnosticsPath, "utf8");
  const diagnostics = JSON.parse(text);
  if (
    diagnostics.schema !== "pi67-support-diagnostics.v3"
    || diagnostics.runtime !== undefined
    || diagnostics.runtimeCollection?.failure !== "connection-unavailable"
    || diagnostics.renderer?.activeRequestCount !== 0
    || diagnostics.renderer?.slowThresholdMs !== 2_000
    || diagnostics.agentHost?.phase !== "idle"
    || diagnostics.piConfiguration?.agentDirectory?.state !== "available"
    || diagnostics.piConfiguration?.files?.find((entry) => entry.file === "auth.json")?.state !== "valid-json"
  ) {
    throw new Error(`Packaged Main-only diagnostics were incomplete: ${JSON.stringify(diagnostics)}`);
  }
  for (const sensitiveValue of [options.packagedCredential, options.agentDir, options.workspace]) {
    if (text.includes(sensitiveValue)) {
      throw new Error("Packaged Main-only diagnostics exposed a credential or absolute path.");
    }
  }
}
