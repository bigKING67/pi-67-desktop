import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const distribution = "volcengine_python_sdk-5.0.48.dist-info";
const catalogSha256 = "749414bad1c51fac5cacbc79e9adf0a75744855f51622014a9ce564a689675a0";
const retained = ["volcenginesdkark", "volcenginesdkarkruntime", "volcenginesdkcore"];
const hash = bytes => createHash("sha256").update(bytes).digest("base64url");

// Only a fresh, owned preparation staging tree. Never mutate an installed,
// signed or already measured runtime. A lockfile/catalog upgrade requires review.
export async function pruneOpenVikingSdk(staging) {
  if (basename(staging) !== "staging" || !/^preparation-[a-zA-Z0-9]+$/u.test(basename(dirname(staging)))
    || await realpath(staging) !== resolve(staging)) throw new Error("SDK pruning requires canonical preparation staging.");
  const owner = JSON.parse(await readFile(join(dirname(staging), "native-artifact.json"), "utf8"));
  if (owner.schema !== "new-money.native-artifact.v1" || owner.kind !== "preparation" || owner.status !== "BUILDING") {
    throw new Error("SDK pruning requires an owned in-progress preparation.");
  }
  const site = join(staging, "lib/python3.12/site-packages");
  if (await realpath(site) !== site) throw new Error("Unsafe SDK site-packages.");
  const metadataRoot = join(site, distribution);
  if (await realpath(metadataRoot) !== metadataRoot) throw new Error("Unsafe SDK metadata.");
  const metadata = await readFile(join(metadataRoot, "METADATA"), "utf8");
  if (!/^Name: volcengine-python-sdk$/mu.test(metadata) || !/^Version: 5\.0\.48$/mu.test(metadata)) {
    throw new Error("Unreviewed SDK distribution version.");
  }
  const topLevel = await readFile(join(metadataRoot, "top_level.txt"));
  if (createHash("sha256").update(topLevel).digest("hex") !== catalogSha256) throw new Error("Unreviewed SDK module catalog.");
  const names = topLevel.toString("utf8").trim().split("\n");
  const removed = names.filter(name => !retained.includes(name));
  const recordPath = join(metadataRoot, "RECORD");
  const originalRecord = await readFile(recordPath, "utf8");
  const records = new Map();
  for (const line of originalRecord.trim().split("\n")) {
    const parts = line.replace(/\r$/u, "").split(",");
    if (parts.length !== 3 || records.has(parts[0]) || !parts[0] || parts[0].split("/").includes("..")
      || parts[0].startsWith("/") || parts[0].includes("\\")) throw new Error("Unsafe SDK RECORD.");
    records.set(parts[0], parts);
  }
  let removedBytes = 0; let removedFiles = 0;
  const visited = new Set();
  async function validate(path, name, discard) {
    const stat = await lstat(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const child of await readdir(path)) await validate(join(path, child), `${name}/${child}`, discard);
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      const row = records.get(name); const bytes = await readFile(path);
      if (!row || row[1] !== `sha256=${hash(bytes)}` || row[2] !== String(bytes.length)) {
        throw new Error("SDK file does not match locked RECORD bytes.");
      }
      visited.add(name);
      if (discard) { removedBytes += bytes.length; removedFiles += 1; }
    } else throw new Error("Unsafe SDK payload entry.");
  }
  // Validate all SDK modules before the first deletion, including kept modules.
  for (const name of names) await validate(join(site, name), name, removed.includes(name));
  for (const name of records.keys()) {
    if (name.startsWith("volcenginesdk") && !visited.has(name)) throw new Error("SDK RECORD references missing or unreviewed payload.");
  }
  for (const name of ["top_level.txt", "METADATA"]) {
    const bytes = await readFile(join(metadataRoot, name)); const row = records.get(`${distribution}/${name}`);
    if (!row || row[1] !== `sha256=${hash(bytes)}` || row[2] !== String(bytes.length)) throw new Error("SDK metadata integrity mismatch.");
  }
  for (const name of ["top_level.txt", "RECORD"]) {
    if (!(await lstat(join(metadataRoot, name))).isFile()) throw new Error("Unsafe SDK metadata file.");
  }
  for (const name of removed) await rm(join(site, name), { recursive: true });
  const slimTopLevel = `${retained.join("\n")}\n`;
  await writeFile(join(metadataRoot, "top_level.txt"), slimTopLevel);
  const next = [...records.values()].filter(([name]) => !removed.includes(name.split("/")[0])).map(row => {
    if (row[0] === `${distribution}/top_level.txt`) return [row[0], `sha256=${hash(slimTopLevel)}`, String(Buffer.byteLength(slimTopLevel))];
    return row;
  });
  await writeFile(recordPath, `${next.map(row => row.join(",")).join("\n")}\n`);
  return { revision: "volcengine-ark-only-v1", version: "5.0.48", retained, removedModules: removed.length, removedFiles, removedBytes };
}
