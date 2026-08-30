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

export async function preparePackagedProjectedImage(window) {
  const name = "pi67-restored-image.png";
  const payload = await readFile(join(repositoryRoot, "eng/packaging/icon.png"));
  await dropAttachment(window, name, "image/png", payload);
  await waitForRendererText(window, '[data-attachment-kind="image"]', name, 15_000);
  return { byteLength: payload.byteLength, name };
}

export async function verifyPackagedProjectedImage(window, stage) {
  const image = window.getByRole("img", { name: "会话图片" }).last();
  await image.waitFor({ state: "visible", timeout: 30_000 });
  const source = await image.getAttribute("src");
  if (!source?.startsWith("blob:")) {
    throw new Error(`Packaged projected image did not use a Blob URL after ${stage}.`);
  }
  await window.waitForTimeout(750);
  await image.waitFor({ state: "visible", timeout: 5_000 });
  await window.locator('[data-runtime-phase="ready"]')
    .waitFor({ state: "visible", timeout: 5_000 });
}

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
  const sourcePayload = await readFile(sourcePath);
  const invalidPayload = await readFile(invalidPath);

  const composer = window.getByLabel("给 Pi 发送消息");
  await composer.fill("HEIC packaged 草稿保留检查");
  const startedAt = Date.now();
  await dropAttachment(window, "pi67-batch-c-real.heic", "image/heic", sourcePayload);
  const normalized = await waitForRendererText(
    window,
    '[data-attachment-kind="image"]',
    "pi67-batch-c-real.jpg",
    45_000
  );
  if (normalized.hasImage) {
    throw new Error("Packaged normalized HEIC exposed the original HEIC object URL.");
  }
  if (await composerText(window) !== "HEIC packaged 草稿保留检查") {
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
  await clickButtonByLabel(window, "移除附件：pi67-batch-c-real.jpg");
  await waitForManifestRemoval(staged.manifestPath);

  await dropAttachment(window, "fixture-decode-failure.heic", "image/heic", invalidPayload);
  await waitForRendererText(window, '[role="alert"]', "无法从文件内容确认 HEIC/HEIF 图片", 15_000);
  if (await composerText(window) !== "HEIC packaged 草稿保留检查") {
    throw new Error("Packaged HEIC decode failure changed the Composer draft text.");
  }

  await dropAttachment(window, "pi67-batch-c-real.heic", "image/heic", sourcePayload);
  await waitForRendererText(window, '[data-attachment-kind="image"]', "pi67-batch-c-real.jpg", 45_000);
  await clickButtonByLabel(window, "移除附件：pi67-batch-c-real.jpg");
  await setComposerText(window, "");
  return {
    status: "passed",
    sourceBytes,
    stagedBytes: staged.payload.byteLength,
    width: jpeg.width,
    height: jpeg.height,
    elapsedMs: Date.now() - startedAt
  };
}

async function dropAttachment(window, name, mimeType, bytes) {
  // Playwright's Electron path-based file injection can stop answering CDP
  // after the app handles the file. A real DragEvent avoids that driver seam.
  await window.evaluate((payload) => {
    const element = document.querySelector('[data-testid="composer-shell"]');
    if (!(element instanceof HTMLElement)) throw new Error("Packaged Composer shell is unavailable.");
    const decoded = Uint8Array.from(atob(payload.base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([decoded], payload.name, { type: payload.mimeType }));
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  }, { base64: bytes.toString("base64"), mimeType, name });
}

async function waitForRendererText(window, selector, text, timeoutMs) {
  return window.evaluate(({ selector: expectedSelector, text: expectedText, timeout }) => (
    new Promise((resolve, reject) => {
      const inspect = () => {
        const element = [...document.querySelectorAll(expectedSelector)]
          .find((candidate) => candidate.textContent?.includes(expectedText));
        if (!element) return false;
        resolve({ hasImage: element.querySelector("img") !== null, text: element.textContent ?? "" });
        return true;
      };
      if (inspect()) return;
      const observer = new MutationObserver(() => {
        if (!inspect()) return;
        observer.disconnect();
        clearTimeout(timer);
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for ${expectedSelector} containing ${expectedText}.`));
      }, timeout);
      observer.observe(document.body, { childList: true, subtree: true });
    })
  ), { selector, text, timeout: timeoutMs });
}

async function clickButtonByLabel(window, label) {
  await window.evaluate((expectedLabel) => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.getAttribute("aria-label") === expectedLabel);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button ${expectedLabel} is unavailable.`);
    button.click();
  }, label);
}

function composerText(window) {
  return window.evaluate(() => {
    const composer = document.querySelector('textarea[aria-label="给 Pi 发送消息"]');
    if (!(composer instanceof HTMLTextAreaElement)) throw new Error("Packaged Composer input is unavailable.");
    return composer.value;
  });
}

async function setComposerText(window, text) {
  await window.evaluate((nextText) => {
    const composer = document.querySelector('textarea[aria-label="给 Pi 发送消息"]');
    if (!(composer instanceof HTMLTextAreaElement)) throw new Error("Packaged Composer input is unavailable.");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(composer, nextText);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
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
