#!/usr/bin/env node
// Downloads the pinned Noto Sans CJK SC Regular OTF named in fonts/manifest.json
// when it is missing, verifying byte count and SHA-256 before publishing it.
// The font binary stays out of Git; OFL.txt ships beside it.
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const manifestUrl = new URL("../fonts/manifest.json", import.meta.url);
const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
const target = fileURLToPath(new URL(`../fonts/${manifest.file}`, import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const verify = (bytes) => {
  if (bytes.length !== manifest.bytes || sha256(bytes) !== manifest.sha256) throw new Error("Pinned font digest mismatch");
};

let existing;
try {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Pinned font must be a regular file");
  existing = await fs.readFile(target);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existing) verify(existing);
else {
  const response = await fetch(manifest.source, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Font download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verify(bytes);
  const temp = `${target}.pending-${process.pid}`;
  await fs.writeFile(temp, bytes, { flag: "wx" });
  try { await fs.link(temp, target); } catch (error) { if (error.code !== "EEXIST") throw error; } finally { await fs.unlink(temp); }
  verify(await fs.readFile(target));
}
console.log(JSON.stringify({ status: "verified", file: manifest.file, sha256: manifest.sha256, bytes: manifest.bytes }));
