import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPreparedDesktopToolchain,
  prepareDesktopToolchain
} from "./prepare-toolchain.mjs";
import { prepareDesktopCapabilities } from "../capabilities/prepare-capabilities.mjs";
import { assertPreparedDesktopCapabilities } from "../capabilities/prepared-capabilities-validation.mjs";

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

  console.log(JSON.stringify({
    platform,
    architecture,
    reusedToolchain,
    reusedCapabilities
  }));
  return { reusedToolchain, reusedCapabilities };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensurePreparedRuntimeResources();
}
