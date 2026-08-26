import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { repositoryRoot } from "./packaged-electron-fixture.mjs";

const executeFile = promisify(execFile);

export async function verifyPackagedHeicAttachment({ artifact, userDataDirectory, window }) {
  if (artifact.platform !== "darwin" || artifact.arch !== "arm64") {
    return { status: "skipped-target" };
  }
  const fixtureRoot = join(userDataDirectory, "heic-attachment-smoke");
  const sourcePath = join(fixtureRoot, "pi67-batch-c-real.heic");
  const invalidPath = join(fixtureRoot, "fixture-decode-failure.heic");
  await mkdir(fixtureRoot, { recursive: true });
  await executeFile("sips", [
    "-s",
    "format",
    "heic",
    join(repositoryRoot, "eng/packaging/icon.png"),
    "--out",
    sourcePath
  ], { timeout: 30_000, maxBuffer: 64 * 1024 });
  await writeFile(invalidPath, "not-heic", "utf8");

  const composer = window.getByLabel("给 Pi 发送消息");
  await composer.fill("HEIC packaged 草稿保留检查");
  const startedAt = Date.now();
  await window.getByLabel("选择附件").setInputFiles(sourcePath);
  const normalized = window.locator('[data-attachment-kind="image"]').filter({ hasText: "pi67-batch-c-real.jpg" });
  await normalized.waitFor({ state: "visible", timeout: 45_000 });
  if (await normalized.getByRole("img").count()) {
    throw new Error("Packaged normalized HEIC exposed the original HEIC object URL.");
  }
  if (await composer.inputValue() !== "HEIC packaged 草稿保留检查") {
    throw new Error("Packaged HEIC normalization changed the Composer draft text.");
  }

  const staged = await waitForStagedJpeg(userDataDirectory, "pi67-batch-c-real.jpg");
  const sourceBytes = (await stat(sourcePath)).size;
  const jpeg = inspectJpeg(staged.payload);
  if (staged.manifest.mimeType !== "image/jpeg" || staged.manifest.kind !== "image"
    || staged.manifest.byteLength !== staged.payload.byteLength
    || staged.manifest.sha256 !== createHash("sha256").update(staged.payload).digest("hex")) {
    throw new Error("Packaged normalized HEIC manifest did not bind the staged JPEG payload.");
  }
  await window.getByRole("button", { name: "移除附件：pi67-batch-c-real.jpg" }).click();
  await waitForManifestRemoval(staged.manifestPath);

  await window.getByLabel("选择附件").setInputFiles(invalidPath);
  await window.getByRole("alert").filter({ hasText: "无法从文件内容确认 HEIC/HEIF 图片" })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await composer.inputValue() !== "HEIC packaged 草稿保留检查") {
    throw new Error("Packaged HEIC decode failure changed the Composer draft text.");
  }

  await window.getByLabel("选择附件").setInputFiles(sourcePath);
  await normalized.waitFor({ state: "visible", timeout: 45_000 });
  await window.getByRole("button", { name: "移除附件：pi67-batch-c-real.jpg" }).click();
  await composer.fill("");
  return {
    status: "passed",
    sourceBytes,
    stagedBytes: staged.payload.byteLength,
    width: jpeg.width,
    height: jpeg.height,
    elapsedMs: Date.now() - startedAt
  };
}

async function waitForStagedJpeg(userDataDirectory, name) {
  const root = join(userDataDirectory, "runtime/prompt-attachments");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const run of await safeDirectories(root)) {
      const draftRoot = join(root, run, "draft");
      for (const id of await safeDirectories(draftRoot)) {
        const manifestPath = join(draftRoot, id, "manifest.json");
        const manifest = await readFile(manifestPath, "utf8")
          .then((text) => JSON.parse(text))
          .catch(() => undefined);
        if (manifest?.name !== name) continue;
        return {
          manifest,
          manifestPath,
          payload: await readFile(join(draftRoot, id, "payload.bin"))
        };
      }
    }
    await delay(50);
  }
  throw new Error("Packaged normalized HEIC staging manifest was not found.");
}

async function waitForManifestRemoval(manifestPath) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const present = await stat(manifestPath).then(() => true).catch(() => false);
    if (!present) return;
    await delay(25);
  }
  throw new Error("Packaged normalized HEIC staging directory was not released.");
}

async function safeDirectories(root) {
  return readdir(root, { withFileTypes: true }).then((entries) => (
    entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .slice(0, 32)
      .map((entry) => entry.name)
  )).catch(() => []);
}

function inspectJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new Error("Packaged normalized HEIC payload is not a complete JPEG.");
  }
  let offset = 2;
  let dimensions;
  while (offset < bytes.byteLength - 2) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) {
      throw new Error("Packaged normalized HEIC JPEG segment is invalid.");
    }
    if (marker === 0xe1 || marker === 0xe2 || marker === 0xed || marker === 0xfe) {
      throw new Error("Packaged normalized HEIC JPEG retained metadata.");
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      dimensions = {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      };
    }
    offset += length;
  }
  if (!dimensions) throw new Error("Packaged normalized HEIC JPEG dimensions were not found.");
  return dimensions;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
