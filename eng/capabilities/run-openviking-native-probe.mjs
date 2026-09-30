import { spawn } from "node:child_process";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const probeSource = join(repositoryRoot, "eng/capabilities/probe-openviking-native.mjs");

// Bundle the TypeScript-backed Main probe graph before running it. Production
// source keeps emitted .mjs imports, which bare Node cannot resolve to .mts.
export async function runBundledOpenVikingNativeProbe(python, { execute = executeCommand } = {}) {
  if (typeof python !== "string" || !isAbsolute(python) || python.includes("\0")) {
    throw new Error("Pass an absolute isolated Python executable.");
  }
  const output = await mkdtemp(join(tmpdir(), "pi67-openviking-native-probe-"));
  try {
    await execute("corepack", ["pnpm", "exec", "tsdown", probeSource, "--format", "esm", "--dts", "false", "--out-dir", output],
      { cwd: repositoryRoot });
    const entry = join(output, "probe-openviking-native.mjs");
    const metadata = await lstat(entry);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Native probe bundle was not created safely.");
    await execute(process.execPath, [entry, python], { cwd: repositoryRoot });
  } finally {
    await rm(output, { force: true, recursive: true });
  }
}

async function executeCommand(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Native probe command failed (${signal ?? code}).`));
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runBundledOpenVikingNativeProbe(process.argv[2]); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
