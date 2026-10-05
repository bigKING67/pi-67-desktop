import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";

const executeFile = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const schema = "pi67.windows-ci-transport.v1";

function validateContext(context) {
  if (!/^[a-f0-9]{40}$/u.test(context?.sourceSha ?? "")
    || !/^[1-9][0-9]*$/u.test(context?.runId ?? "")
    || !/^[1-9][0-9]*$/u.test(context?.buildAttempt ?? "")) {
    throw new Error("Windows CI transport requires exact source, run and build attempt.");
  }
}

function layout(kind, version) {
  if (!["runtime", "installer"].includes(kind) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("Invalid Windows CI transport kind or version.");
  }
  const executable = "win-unpacked/New Money.exe";
  return kind === "runtime"
    ? { members: ["win-unpacked"], files: [executable, "win-unpacked/resources/app.asar"] }
    : { members: [`New-Money-${version}-win-x64.exe`, executable], files: [`New-Money-${version}-win-x64.exe`, executable] };
}

async function assertOrdinaryTree(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
    throw new Error("Windows CI transport contains a link or special file.");
  }
  if (metadata.isDirectory()) {
    for (const entry of await readdir(path)) await assertOrdinaryTree(join(path, entry));
  }
}

async function assertEmptyDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length !== 0) throw new Error("Windows CI transport destination is not empty.");
}

async function fileIdentities(root, files) {
  return Promise.all(files.map(async path => ({ path, ...await readFileByteIdentity(join(root, path)) })));
}

function assertByteIdentity(actual, expected) {
  if (!Number.isSafeInteger(expected?.byteLength) || expected.byteLength <= 0
    || !/^[a-f0-9]{64}$/u.test(expected?.sha256 ?? "")
    || actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
    throw new Error("Windows CI transport byte identity mismatch.");
  }
}

/** Fixed producer-owned paths only; no arbitrary archive source/destination from the manifest. */
export async function createWindowsCiArtifact({ root, kind, version, context, execute = executeFile }) {
  validateContext(context);
  const { members, files } = layout(kind, version);
  const release = join(root, "artifacts/release");
  const directory = join(root, `artifacts/ci/windows-${kind}`);
  await assertEmptyDirectory(directory);
  for (const member of members) await assertOrdinaryTree(join(release, member));
  const identities = await fileIdentities(release, files);
  const archive = join(directory, "payload.tar");
  // Upload-artifact performs the one compression pass. Tar preserves the runtime
  // tree without per-file artifact upload overhead or a second compression pass.
  await execute("tar", ["-cf", archive, "-C", release, ...members], { timeout: 300_000, maxBuffer: 64 * 1024 });
  const after = await fileIdentities(release, files);
  after.forEach((value, index) => assertByteIdentity(value, identities[index]));
  const identity = { schema, ...context, kind, version, archive: await readFileByteIdentity(archive), files: identities };
  const text = `${JSON.stringify(identity, null, 2)}\n`;
  await writeFile(join(directory, "identity.json"), text, { flag: "wx" });
  return { identitySha256: createHash("sha256").update(text).digest("hex"), identity };
}

export async function restoreWindowsCiArtifact({ root, kind, version, context, identitySha256, execute = executeFile }) {
  validateContext(context);
  const { files } = layout(kind, version);
  const directory = join(root, `artifacts/ci/windows-${kind}`);
  const identityPath = join(directory, "identity.json");
  await readFileByteIdentity(identityPath); // Reject links and non-regular files before reading.
  const text = await readFile(identityPath);
  if (!/^[a-f0-9]{64}$/u.test(identitySha256 ?? "")
    || createHash("sha256").update(text).digest("hex") !== identitySha256) {
    throw new Error("Windows CI transport manifest does not match the producer output.");
  }
  const identity = JSON.parse(text.toString("utf8"));
  if (identity.schema !== schema || identity.kind !== kind || identity.version !== version
    || identity.sourceSha !== context.sourceSha || identity.runId !== context.runId
    || identity.buildAttempt !== context.buildAttempt
    || !Array.isArray(identity.files) || identity.files.length !== files.length
    || identity.files.some((file, index) => file.path !== files[index])) {
    throw new Error("Windows CI transport source, run, attempt or content scope mismatch.");
  }
  const archive = join(directory, "payload.tar");
  assertByteIdentity(await readFileByteIdentity(archive), identity.archive);
  const release = join(root, "artifacts/release");
  await assertEmptyDirectory(release);
  await execute("tar", ["-xf", archive, "-C", release], { timeout: 300_000, maxBuffer: 64 * 1024 });
  for (const member of layout(kind, version).members) await assertOrdinaryTree(join(release, member));
  const actual = await fileIdentities(release, files);
  actual.forEach((value, index) => assertByteIdentity(value, identity.files[index]));
  return identity;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, kind, ...extra] = process.argv.slice(2);
  if (!["create", "restore"].includes(operation) || extra.length || process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Expected Windows x64 CI transport create/restore and runtime/installer kind.");
  }
  const { version } = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const context = {
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    buildAttempt: operation === "create" ? process.env.GITHUB_RUN_ATTEMPT : process.env.PI67_WINDOWS_BUILD_ATTEMPT
  };
  const started = performance.now();
  if (operation === "create") {
    if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GitHub producer output.");
    const result = await createWindowsCiArtifact({ root: repositoryRoot, kind, version, context });
    await appendFile(process.env.GITHUB_OUTPUT, `identity-sha256=${result.identitySha256}\nbuild-attempt=${context.buildAttempt}\n`);
    console.log(JSON.stringify({ operation, kind, durationMs: Math.round(performance.now() - started), archiveBytes: result.identity.archive.byteLength }));
  } else {
    await restoreWindowsCiArtifact({ root: repositoryRoot, kind, version, context, identitySha256: process.env.PI67_WINDOWS_IDENTITY_SHA256 });
    console.log(JSON.stringify({ operation, kind, durationMs: Math.round(performance.now() - started), identity: "verified" }));
  }
}
