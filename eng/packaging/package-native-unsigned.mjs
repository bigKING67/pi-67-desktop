import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const electronBuilderCli = resolve(root, "node_modules/electron-builder/out/cli/cli.js");

export function resolveUnsignedNativeTarget(platform, arch, options = {}) {
  if (platform === "win32" && arch === "x64") {
    return {
      label: "windows-x64",
      arguments: [
        "--win",
        "nsis",
        "--x64",
        ...(options.ciFast ? ["-c.compression=store"] : []),
        "--publish",
        "never"
      ]
    };
  }
  if (platform === "darwin" && arch === "arm64") {
    if (options.ciFast) throw new Error("Fast unsigned packaging is supported only for Windows CI smoke.");
    return {
      label: "macos-arm64",
      arguments: ["--mac", "dmg", "zip", "--arm64", "-c.mac.notarize=false", "--publish", "never"]
    };
  }
  throw new Error(`Unsigned native packaging does not support ${platform}/${arch}.`);
}

export function unsignedPackagingEnvironment(source) {
  const environment = { ...source, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  for (const name of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "CSC_NAME",
    "WIN_CSC_LINK",
    "WIN_CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER"
  ]) {
    delete environment[name];
  }
  return environment;
}

export async function packageUnsignedNative(
  platform = process.platform,
  arch = process.arch,
  options = {}
) {
  const target = resolveUnsignedNativeTarget(platform, arch, options);
  await access(electronBuilderCli);
  if (options.preparedResources) {
    const { assertPreparedDesktopToolchain } = await import("./prepare-toolchain.mjs");
    const { assertPreparedDesktopCapabilities } = await import("../capabilities/prepared-capabilities-validation.mjs");
    await assertPreparedDesktopToolchain(platform, arch);
    await assertPreparedDesktopCapabilities();
  } else {
    const { prepareDesktopToolchain } = await import("./prepare-toolchain.mjs");
    const { prepareDesktopCapabilities } = await import("../capabilities/prepare-capabilities.mjs");
    await prepareDesktopToolchain(platform, arch);
    await prepareDesktopCapabilities();
  }
  const exitCode = await run(process.execPath, [electronBuilderCli, ...target.arguments], {
    cwd: root,
    env: unsignedPackagingEnvironment(process.env)
  });
  if (exitCode !== 0) throw new Error(`Unsigned ${target.label} packaging failed with exit code ${exitCode}.`);
  console.log(`Built unsigned native smoke package for ${target.label}.`);
}

export function parseUnsignedPackagingArguments(arguments_) {
  const options = { preparedResources: false, ciFast: false };
  for (const argument of arguments_) {
    if (argument === "--prepared-resources") options.preparedResources = true;
    else if (argument === "--ci-fast") options.ciFast = true;
    else throw new Error(`Unknown unsigned packaging argument: ${argument}`);
  }
  return options;
}

function run(command, arguments_, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`electron-builder terminated by ${signal}.`));
      else resolvePromise(code ?? 1);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageUnsignedNative(
    process.platform,
    process.arch,
    parseUnsignedPackagingArguments(process.argv.slice(2))
  );
}
