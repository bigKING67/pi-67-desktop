import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { MACOS_ICON_CONTRACT } from "./macos-icon-contract.mjs";

const execFile = promisify(execFileCallback);
const packagingDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(
  readArgument("--source-dir") ?? join(packagingDirectory, "pi-icon-sources")
);
const outputPath = resolve(readArgument("--output") ?? join(packagingDirectory, "pi.icns"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-macos-icon-"));
const iconsetPath = join(temporaryRoot, "pi.iconset");
const browser = await chromium.launch({ channel: "chromium", headless: true });

try {
  await mkdir(iconsetPath, { recursive: true });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");

  for (const representation of MACOS_ICON_CONTRACT.representations) {
    const sourcePath = await resolveSourcePath(representation.size);
    const source = await readFile(sourcePath);
    const pngBase64 = await page.evaluate(async ({
      contentRatio,
      size,
      sourceBase64
    }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${sourceBase64}`;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable.");
      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      const contentSize = size * contentRatio;
      const inset = (size - contentSize) / 2;
      context.drawImage(image, inset, inset, contentSize, contentSize);
      return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/u, "");
    }, {
      contentRatio: MACOS_ICON_CONTRACT.contentSize / MACOS_ICON_CONTRACT.canvasSize,
      size: representation.size,
      sourceBase64: source.toString("base64")
    });
    await writeFile(join(iconsetPath, representation.fileName), Buffer.from(pngBase64, "base64"));
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await execFile("iconutil", ["-c", "icns", "-o", outputPath, iconsetPath]);
  process.stdout.write([
    `Generated ${outputPath}`,
    `canvas=${MACOS_ICON_CONTRACT.canvasSize}`,
    `content=${MACOS_ICON_CONTRACT.contentSize}`,
    `inset=${MACOS_ICON_CONTRACT.inset}`
  ].join(" ") + "\n");
} finally {
  await browser.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function resolveSourcePath(size) {
  const sizedSource = resolve(sourceDirectory, "png", `pi_icon_${size}x${size}.png`);
  try {
    await access(sizedSource);
    return sizedSource;
  } catch {
    // The 1024px representation is the repository master; other gaps fall back safely.
  }
  return join(packagingDirectory, "icon.png");
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
