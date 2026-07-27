import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  replaceMockAgentHost
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("loads projected image assets through chunked Blob URLs and revokes them on Host replacement", async ({ page }) => {
  await page.addInitScript(() => {
    const revoked: string[] = [];
    const original = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(window, "__pi67RevokedAssetUrls", { value: revoked, configurable: true });
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      original(url);
    };
  });
  const bytes = Buffer.from(PIXEL_PNG_BASE64, "base64");
  const assetId = "asset-pixel";
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "image-entry",
    role: "assistant",
    parts: [{
      type: "image",
      mimeType: "image/png",
      name: "pixel.png",
      asset: { id: assetId, byteLength: bytes.byteLength, sessionGeneration: 1 }
    }]
  }], {}, {
    assets: {
      [assetId]: { mimeType: "image/png", dataBase64: PIXEL_PNG_BASE64, sessionGeneration: 1 }
    }
  });
  await page.getByRole("button", { name: "选择工作区" }).click();

  const image = page.getByRole("img", { name: "pixel.png" });
  await expect(image).toBeVisible();
  const objectUrl = await image.getAttribute("src");
  expect(objectUrl).toMatch(/^blob:/u);
  expect(objectUrl).not.toMatch(/^data:/u);
  const reads = (await recordedCommandDetails(page)).filter((command) => command.type === "asset.read");
  expect(reads).toHaveLength(1);
  expect(reads[0]?.payload).toEqual({
    assetId,
    sessionGeneration: 1,
    offset: 0,
    length: bytes.byteLength
  });

  await replaceMockAgentHost(page);
  await expect.poll(() => page.evaluate((url) => (
    window as unknown as { __pi67RevokedAssetUrls: string[] }
  ).__pi67RevokedAssetUrls.includes(url ?? ""), objectUrl)).toBe(true);
});

test("shows a retryable state when an asset handle is unavailable", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "missing-image-entry",
    role: "assistant",
    parts: [{
      type: "image",
      mimeType: "image/png",
      name: "missing.png",
      asset: { id: "asset-missing", byteLength: 3, sessionGeneration: 1 }
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("图片未能从 Agent Host 加载。")).toBeVisible();
  await expect.poll(async () => (
    await recordedCommands(page)
  ).filter((command) => command === "asset.read").length).toBe(1);
  await page.getByRole("button", { name: "重试" }).click();
  await expect.poll(async () => (
    await recordedCommands(page)
  ).filter((command) => command === "asset.read").length).toBe(2);
});

const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
