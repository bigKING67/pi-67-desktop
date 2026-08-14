import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPreparedDesktopToolchain,
  prepareDesktopToolchain
} from "./prepare-toolchain.mjs";
import { prepareDesktopCapabilities } from "../capabilities/prepare-capabilities.mjs";
import { assertPreparedDesktopCapabilities } from "../capabilities/prepared-capabilities-validation.mjs";
import {
  assertPreparedWindowsJobController,
  prepareWindowsJobController
} from "./prepare-windows-job-controller.mjs";

export async function ensurePreparedRuntimeResources(
  platform = process.platform,
  architecture = process.arch
) {
  let reusedToolchain = true;
  try {
    await assertPreparedDesktopToolchain(platform, architecture);
  } catch {
    reusedToolchain = false;
    await prepareDesktopToolchain(platform, architecture);
    await assertPreparedDesktopToolchain(platform, architecture);
  }

  let reusedCapabilities = true;
  try {
    await assertPreparedDesktopCapabilities();
  } catch {
    reusedCapabilities = false;
    await prepareDesktopCapabilities();
    await assertPreparedDesktopCapabilities();
  }

  let reusedWindowsJobController = true;
  try {
    await assertPreparedWindowsJobController(platform, architecture);
  } catch {
    reusedWindowsJobController = false;
    await prepareWindowsJobController(platform, architecture);
    await assertPreparedWindowsJobController(platform, architecture);
  }

  console.log(JSON.stringify({
    platform,
    architecture,
    reusedToolchain,
    reusedCapabilities,
    reusedWindowsJobController
  }));
  return { reusedToolchain, reusedCapabilities, reusedWindowsJobController };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensurePreparedRuntimeResources();
}
