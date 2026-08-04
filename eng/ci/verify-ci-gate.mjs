import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyCiGateResults(input) {
  if (input.scopeResult !== "success") {
    throw new Error(`Change scope did not succeed: ${input.scopeResult}`);
  }
  assertRequiredResult("quality", input.runQuality, input.qualityResult);
  assertRequiredResult("Windows native", input.runWindows, input.windowsResult);
  assertRequiredResult("macOS native", input.runMacos, input.macosResult);
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
  if (arguments_.length !== 7) {
    throw new Error("Expected scope result followed by three selection/result pairs.");
  }
  return {
    scopeResult: arguments_[0],
    runQuality: arguments_[1],
    qualityResult: arguments_[2],
    runWindows: arguments_[3],
    windowsResult: arguments_[4],
    runMacos: arguments_[5],
    macosResult: arguments_[6]
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCiGateResults(parseArguments(process.argv.slice(2)));
  console.log("CI Gate passed for the selected validation scope.");
}
