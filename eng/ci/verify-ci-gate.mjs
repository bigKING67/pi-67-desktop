import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyCiGateResults(input) {
  if (input.scopeResult !== "success") {
    throw new Error(`Change scope did not succeed: ${input.scopeResult}`);
  }
  const reuseRequested = input.reuseWindowsInstaller === "true";
  if (reuseRequested && !["true", "false"].includes(input.reuseAvailable)) {
    throw new Error(`Windows installer reuse resolution was invalid: ${input.reuseAvailable}.`);
  }
  const reuseSelected = reuseRequested && input.reuseAvailable === "true";
  const qualityRequired = input.runQuality === "true" || (reuseRequested && !reuseSelected);
  const windowsRequired = input.runWindows === "true" || (reuseRequested && !reuseSelected);

  assertRequiredResult("quality", String(qualityRequired), input.qualityResult);
  assertRequiredResult("Windows native", String(windowsRequired), input.windowsResult);
  assertRequiredResult("macOS native", input.runMacos, input.macosResult);
  assertRequiredResult("Windows installer reused candidate", String(reuseSelected), input.windowsReuseResult);
}

function assertRequiredResult(label, required, result) {
  if (required === "true" && result !== "success") {
    throw new Error(`${label} validation was required but finished with ${result}.`);
  }
  if (required === "false" && result !== "skipped") {
    throw new Error(`${label} validation was not selected but finished with ${result}.`);
  }
}

function parseArguments(arguments_) {
  if (arguments_.length !== 10) {
    throw new Error("Expected scope result, three validation pairs, and Windows installer reuse resolution.");
  }
  return {
    scopeResult: arguments_[0],
    runQuality: arguments_[1],
    qualityResult: arguments_[2],
    runWindows: arguments_[3],
    windowsResult: arguments_[4],
    runMacos: arguments_[5],
    macosResult: arguments_[6],
    reuseWindowsInstaller: arguments_[7],
    reuseAvailable: arguments_[8],
    windowsReuseResult: arguments_[9]
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCiGateResults(parseArguments(process.argv.slice(2)));
  console.log("CI Gate passed for the selected validation scope.");
}
