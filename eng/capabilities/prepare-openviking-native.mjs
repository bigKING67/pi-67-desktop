import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyOpenVikingManifest } from "../../apps/desktop/src/openviking-runtime-manifest.mts";
import { assembleOpenVikingTestInstallation } from "./assemble-openviking-test-installation.mjs";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import { applyPrivateRuntimePatch, normalizePrivateRuntimeLaunchers } from "./openviking-runtime-patches.mts";
import { applyQueryEmbeddingPatch } from "./openviking-query-patch.mts";
export { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";

import { runNativeArtifact } from "./native-artifact-store.mjs";
import { nativePreparationKey } from "./native-preparation-inputs.mjs";
import { pruneOpenVikingSdk } from "./prune-openviking-sdk.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// Explicit developer preparation only. No runtime download, user profile adoption,
// production signing or installer integration is implied by this feasibility tool.
export function assertStandalonePython(identity, platform, arch) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error("Native preparation currently requires a real darwin/arm64 host.");
  }
  if (identity.version !== "3.12.10" || identity.prefix !== identity.basePrefix
    || !isAbsolute(identity.prefix) || identity.machine !== "arm64") {
    throw new Error("Supply standalone CPython 3.12.10 arm64, not a virtual environment.");
  }
}

export function includePythonRuntimePath(path) {
  const parts = path.split(/[\\/]/u);
  return !parts.includes("site-packages") && !parts.includes("__pycache__");
}

/** Only in this tool's fresh staging copy, before measuring/signing its tree.
 * Never edits an installed runtime or copies probes, tests or operator keys. */
export async function installTeamWorkerBootstrap(runtimeRoot, purpose = "team-index-v1") {
  if (!["team-index-v1", "team-query-v1"].includes(purpose)) throw new Error("Unsupported team bootstrap purpose.");
  const query = purpose === "team-query-v1";
  const target = join(runtimeRoot, "newmoney-team", query ? "query/v1" : "v1");
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const name of query ? ["team_query_worker.py"] : ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"]) {
    await copyFile(join(repositoryRoot, "eng/capabilities/openviking-runtime", name), join(target, name), constants.COPYFILE_EXCL);
  }
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Native preparation command failed (${signal ?? code}).`));
    });
  });
}

export function parseNativePreparationArguments(args) {
  const [python, ...flags] = args;
  if (!python || !isAbsolute(python) || new Set(flags).size !== flags.length
    || flags.some(flag => !["--team-query-v1", "--private-lazy-litellm-v1", "--private-query-coalescing-v1", "--offline", "--keep-test-installation"].includes(flag))
    || flags.filter(flag => ["--team-query-v1", "--private-lazy-litellm-v1", "--private-query-coalescing-v1"].includes(flag)).length > 1) {
    throw new Error("Expected standalone Python path, at most one purpose, and optional --offline.");
  }
  return { python, purpose: flags.includes("--private-query-coalescing-v1") ? "private-query-coalescing-v1"
    : flags.includes("--private-lazy-litellm-v1") ? "private-lazy-litellm-v1"
    : flags.includes("--team-query-v1") ? "team-query-v1" : "team-index-v1", offline: flags.includes("--offline"), keepTestInstallation: flags.includes("--keep-test-installation") };
}

// Called only with the installation created by this preparation invocation.
// Keep receipts and failed probes; never prune sibling runs or signed inputs.
export async function finalizeTestInstallation(receipt, keep = false) {
  const installed = receipt.testInstallation;
  if (!installed || receipt.nativeProbe !== "PASS" || keep) return;
  installed.runtimeRetention = "CLEANUP_PENDING";
  await rm(join(installed.installationRoot, "runtime"), { recursive: true });
  installed.runtimeRetention = "REMOVED_AFTER_SUCCESS";
}

export async function prepareOpenVikingNative(python, purpose = "team-index-v1", offline = false, keepTestInstallation = false) {
  if (!["team-index-v1", "team-query-v1", "private-lazy-litellm-v1", "private-query-coalescing-v1"].includes(purpose)) throw new Error("Unsupported native preparation purpose.");
  if (!python || !isAbsolute(python)) throw new Error("Pass an absolute standalone Python executable.");
  const { stdout } = await execFileAsync(python, ["-I", "-B", "-c",
    "import sys,platform,json; print(json.dumps(dict(prefix=sys.prefix,basePrefix=sys.base_prefix,version=platform.python_version(),machine=platform.machine())))"]);
  const identity = JSON.parse(stdout);
  assertStandalonePython(identity, process.platform, process.arch);
  const artifacts = join(repositoryRoot, "artifacts/openviking-native");
  const key = await nativePreparationKey({ pythonRoot: identity.prefix, repositoryRoot, purpose,
    keepTestInstallation, includePythonPath: includePythonRuntimePath });
  return runNativeArtifact({ parent: artifacts, kind: "preparation", purpose, key, pin: keepTestInstallation,
    build: async output => {
      return buildPreparedRuntime(output, identity, purpose, offline, keepTestInstallation);
    },
    validate: async (output, receipt) => {
      const afterKey = await nativePreparationKey({ pythonRoot: identity.prefix, repositoryRoot, purpose,
        keepTestInstallation, includePythonPath: includePythonRuntimePath });
      if (key !== afterKey) throw new Error("Preparation inputs changed during operation.");
      if (receipt?.nativeProbe !== "PASS" || receipt.purpose !== purpose
        || receipt.relocatedPython !== join(output, "New Money 本地运行包", "bin/python3.12")) {
        throw new Error("Invalid cached preparation receipt.");
      }
      if ((await runtimeTreeIdentity(join(output, "New Money 本地运行包"))).sha256 !== receipt.tree.sha256) {
        throw new Error("Cached preparation tree changed.");
      }
      if (keepTestInstallation && (await runtimeTreeIdentity(join(receipt.testInstallation.installationRoot, "runtime"))).sha256 !== receipt.tree.sha256) {
        throw new Error("Retained test installation changed.");
      }
    }
  });
}

async function buildPreparedRuntime(output, identity, purpose, offline, keepTestInstallation) {
  const staging = join(output, "staging");
  await cp(identity.prefix, staging, {
    recursive: true, verbatimSymlinks: true,
    filter: (source) => includePythonRuntimePath(relative(identity.prefix, source))
  });
  await runtimeTreeIdentity(staging); // Reject external interpreter/library links before executing the copy.
  const executable = join(staging, "bin/python3.12");
  const requirements = join(repositoryRoot, "eng/capabilities/openviking-runtime/requirements-macos-arm64.txt");
  const lock = await readFile(requirements);
  await run("uv", ["--no-config", ...(offline ? ["--offline"] : []), "pip", "install", "--python", executable,
    "--target", join(staging, "lib/python3.12/site-packages"), "--require-hashes",
    "--no-deps", "--only-binary", ":all:", "--link-mode", "copy", "-r", requirements]);
  const sdkPruning = await pruneOpenVikingSdk(staging);
  let patch;
  let launchers;
  let queryPatch;
  if (["private-lazy-litellm-v1", "private-query-coalescing-v1"].includes(purpose)) {
    launchers = await normalizePrivateRuntimeLaunchers(staging);
    patch = await applyPrivateRuntimePatch(staging);
    if (purpose === "private-query-coalescing-v1") queryPatch = await applyQueryEmbeddingPatch(staging);
  }
  else await installTeamWorkerBootstrap(staging, purpose);
  const before = await runtimeTreeIdentity(staging);
  // Both spaces and non-ASCII paths are normal user installation locations.
  const relocated = join(output, "New Money 本地运行包");
  await rename(staging, relocated);
  const after = await runtimeTreeIdentity(relocated);
  if (before.sha256 !== after.sha256) throw new Error("Runtime identity changed during relocation.");
  // Exercise the admission primitive without inventing a release signing identity.
  // These disposable keys are neither persisted nor trusted by the Desktop product.
  const testIdentity = { platform: process.platform, arch: process.arch, pythonVersion: identity.version,
    openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: after.sha256 };
  const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", ...testIdentity }));
  const testKey = generateKeyPairSync("ed25519");
  verifyOpenVikingManifest(manifest, sign(null, manifest, testKey.privateKey), testKey.publicKey, testIdentity);
  const relocatedPython = join(relocated, "bin/python3.12");
  const { stdout: versions } = await execFileAsync(relocatedPython, ["-I", "-B", "-c",
    "import sys,json; from importlib.metadata import version; print(json.dumps(dict(prefix=sys.prefix,openviking=version('openviking'),sdk=version('openviking-sdk'))))"]);
  const actual = JSON.parse(versions);
  if (actual.prefix !== relocated || actual.openviking !== "0.4.16" || actual.sdk !== "0.1.10") {
    throw new Error("Relocated runtime identity does not match the native contract.");
  }
  if (launchers) await execFileAsync(join(relocated, "lib/python3.12/site-packages/bin/normalizer"), ["--help"],
    { cwd: output, env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" }, timeout: 30_000, maxBuffer: 65_536 });
  const receipt = {
    schema: "new-money.native-runtime-preparation.v1", platform: process.platform, arch: process.arch, purpose,
    pythonVersion: identity.version, openvikingVersion: actual.openviking, sdkVersion: actual.sdk,
    requirementsSha256: createHash("sha256").update(lock).digest("hex"), tree: after,
    ...(patch ? { patch, launchers, relocatedLauncher: "PASS" } : {}), sdkPruning, offline,
    ...(queryPatch ? { queryPatch } : {}),
    relocatedPython, relocatedImport: "PASS", nativeProbe: "PENDING",
    signed: false, pythonDistributionProvenance: "LOCAL_OPERATOR_INPUT",
    signatureVerification: "EPHEMERAL_TEST_KEY_ONLY",
    productionAdmission: "UNVERIFIED", windows: "UNVERIFIED"
  };
  const receiptPath = join(output, "receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  try {
    await run(relocatedPython, ["-I", "-B", join(repositoryRoot, "eng/capabilities/openviking-runtime/ark_sdk_probe.py")]);
    receipt.arkSdkProbe = "PASS";
    await run(process.execPath, [join(repositoryRoot, "eng/capabilities/probe-openviking-native.mjs"), relocatedPython]);
    const afterProbe = await runtimeTreeIdentity(relocated);
    if (afterProbe.sha256 !== after.sha256) throw new Error("Native probe modified the prepared runtime.");
    const installed = await assembleOpenVikingTestInstallation(relocated, after.sha256, output);
    receipt.testInstallation = installed;
    await run(process.execPath, [join(repositoryRoot, "eng/capabilities/probe-openviking-native.mjs"), installed.python]);
    const afterInstalledProbe = await runtimeTreeIdentity(join(installed.installationRoot, "runtime"));
    if (afterInstalledProbe.sha256 !== after.sha256) throw new Error("Native probe modified the assembled runtime.");
    receipt.nativeProbe = "PASS";
    await finalizeTestInstallation(receipt, keepTestInstallation);
  } catch (error) {
    if (receipt.nativeProbe !== "PASS") receipt.nativeProbe = "FAILED";
    throw error;
  } finally {
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    console.log(`Native runtime preparation receipt: ${receiptPath}`);
  }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { python, purpose, offline, keepTestInstallation } = parseNativePreparationArguments(process.argv.slice(2));
  await prepareOpenVikingNative(python, purpose, offline, keepTestInstallation);
}
