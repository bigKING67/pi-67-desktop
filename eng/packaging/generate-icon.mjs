import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const packagingDirectory = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(packagingDirectory, "icon.svg"), "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${source}`);
  await page.screenshot({ path: join(packagingDirectory, "icon.png"), omitBackground: true });
} finally {
  await browser.close();
}
