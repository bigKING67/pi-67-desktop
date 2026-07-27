import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MACOS_FOOTPRINT_COMMAND = join("/", "usr", "bin", "footprint");

export function collectProcessOwnedMemoryBytes(roles, platform = process.platform) {
  if (platform === "darwin") return collectMacPhysicalFootprints(roles);
  if (platform === "win32") {
    return new Map([...roles].map(([role, processInfo]) => {
      if (!Number.isFinite(processInfo.privateBytes) || processInfo.privateBytes <= 0) {
        throw new Error(`Windows process ${processInfo.pid} is missing PrivatePageCount.`);
      }
      return [role, processInfo.privateBytes];
    }));
  }
  throw new Error(`Owned-memory sampling does not support ${platform}.`);
}

export function parseMacPhysicalFootprints(output) {
  const footprints = new Map();
  let currentPid;
  for (const line of output.split("\n")) {
    const header = line.match(/\[(\d+)\]:/u);
    if (header) {
      currentPid = Number(header[1]);
      continue;
    }
    const footprint = line.match(/^\s*phys_footprint:\s+(\d+) B\s*$/u);
    if (currentPid !== undefined && footprint) {
      footprints.set(currentPid, Number(footprint[1]));
      currentPid = undefined;
    }
  }
  return footprints;
}

function collectMacPhysicalFootprints(roles) {
  const arguments_ = [
    "-f",
    "bytes",
    "--noCategories",
    ...[...roles.values()].flatMap((processInfo) => ["-p", String(processInfo.pid)])
  ];
  const output = execFileSync(MACOS_FOOTPRINT_COMMAND, arguments_, { encoding: "utf8" });
  const footprints = parseMacPhysicalFootprints(output);
  return new Map([...roles].map(([role, processInfo]) => {
    const footprint = footprints.get(processInfo.pid);
    if (!Number.isFinite(footprint) || footprint <= 0) {
      throw new Error(`macOS footprint did not report phys_footprint for process ${processInfo.pid}.`);
    }
    return [role, footprint];
  }));
}
