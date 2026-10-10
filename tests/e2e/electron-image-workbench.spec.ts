import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { forwardElectronDebugOutput, nativeElectronAgentDirectory } from "./electron-test-fixtures.js";

// Image workbench P3 evidence (product model §7 B / D / E / F) through the real
// Agent Host and image engine: a photo project, direct edits by pointer and
// keyboard, marks, a reference, a user font, a derived size and a multi-size
// export, then the page at three widths in both themes.

const root = fileURLToPath(new URL("../../", import.meta.url));
const fontFixture = join(root, "packages/image-engine/src/test-support/fonts/KaTeX_SansSerif-Regular.ttf");
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

/** A solid-colour RGB PNG, so the test needs no image library. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, index) => [r, g, b][index % 3]!)]);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

const revisionOf = async (page: Page): Promise<number> => Number(/修订 (\d+)/u.exec(await page.getByTestId("image-project").locator("header").innerText())?.[1]);
const expectRevision = (page: Page, revision: number) => expect.poll(() => revisionOf(page), { timeout: 20_000 }).toBe(revision);

test("image workbench: edits, marks, references, fonts, sizes and export through the real Host, at three widths and both themes", async () => {
  test.setTimeout(240_000);
  const testInfo = test.info();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-electron-image-"));
  const library = join(temporaryRoot, "library"), exports = join(temporaryRoot, "exports"), photo = join(temporaryRoot, "tea.png");
  const agentDir = nativeElectronAgentDirectory(join(temporaryRoot, "agent"));
  await Promise.all([mkdir(library), mkdir(exports), mkdir(agentDir, { recursive: true }), writeFile(photo, solidPng(800, 1000, [214, 196, 168]))]);

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [".", `--user-data-dir=${join(temporaryRoot, "profile")}`],
      cwd: root,
      env: { ...inheritedEnvironment, NODE_ENV: "test", PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }
    });
    forwardElectronDebugOutput(application);
    // Folder pickers answer with whichever folder the step sets.
    const answerFolder = (folder: string) => application!.evaluate(({ dialog }, selected) => {
      Object.defineProperty(dialog, "showOpenDialog", { configurable: true, value: async () => ({ canceled: false, filePaths: [selected] }) });
    }, folder);
    await answerFolder(library);
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1_180, 820); });
    await page.waitForLoadState("domcontentloaded");

    // Library and a photo project.
    await page.getByRole("button", { name: "打开图像" }).click();
    await page.getByRole("button", { name: "选择文件夹" }).click();
    await expect(page.getByRole("heading", { name: "还没有图像项目" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("image-library").locator("input[type=file]").setInputFiles(photo);
    const create = page.getByRole("dialog", { name: "从图片新建图像项目" });
    await create.getByLabel("项目名称").fill("春日茶礼");
    await create.getByLabel("标题文字").fill("春日上新");
    await create.getByRole("button", { name: "创建项目" }).click();
    const project = page.getByTestId("image-project");
    await expect(project).toBeVisible({ timeout: 30_000 });
    await expectRevision(page, 1);
    // On a small screen the window cannot reach 1440 and the Inspector becomes a drawer over
    // the page, so it is opened for its tabs and closed before working on the canvas or bars.
    const inspector = page.locator("#task-inspector");
    const showInspector = async (open: boolean) => {
      if (await inspector.isVisible() !== open) await page.getByTestId("inspector-toggle").click();
      await expect(inspector).toBeVisible({ visible: open });
    };
    const tab = async (name: string) => { await showInspector(true); await inspector.getByRole("tab", { name }).click(); };

    // B. Direct edits: a property, the words, a keyboard move, then undo as a new revision.
    await tab("图层");
    await inspector.getByRole("button", { name: "选择图层 春日上新" }).click();
    await tab("属性");
    await inspector.getByLabel("字号").fill("72");
    await inspector.getByLabel("字号").press("Enter");
    await expectRevision(page, 2);
    await showInspector(false);
    await project.getByLabel("文字内容").fill("春日上新 SALE");
    await project.getByRole("button", { name: "应用" }).click();
    await expectRevision(page, 3);
    const headline = project.getByRole("button", { name: /^文字：春日上新 SALE/u });
    await headline.focus();
    await page.keyboard.press("ArrowRight");
    await expectRevision(page, 4);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expectRevision(page, 5);
    // P4: `]` turns the focused object 15°, shown in 属性; a horizontal flip is one more revision.
    await headline.focus();
    await page.keyboard.press("]");
    await expectRevision(page, 6);
    await tab("属性");
    await expect(inspector.getByLabel("旋转 °")).toHaveValue("15");
    await inspector.getByRole("group", { name: "翻转" }).getByRole("button", { name: "水平翻转" }).click();
    await expectRevision(page, 7);
    await expect(inspector.getByRole("group", { name: "翻转" }).getByRole("button", { name: "水平翻转" })).toHaveAttribute("aria-pressed", "true");

    // D. Marks: draw a region, word it, and see it attached to the next message.
    await showInspector(false);
    await project.getByRole("button", { name: /^标记/u }).click();
    const layer = await project.getByTestId("image-mark-layer").boundingBox();
    expect(layer).not.toBeNull();
    await page.mouse.move(layer!.x + layer!.width * 0.3, layer!.y + layer!.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(layer!.x + layer!.width * 0.7, layer!.y + layer!.height * 0.7, { steps: 8 });
    await page.mouse.up();
    await page.getByLabel("标记 m1 的指令").fill("换成木纹桌面");
    await project.getByRole("button", { name: "完成" }).click();
    const attached = page.getByRole("group", { name: "随消息附带" });
    await expect(attached).toContainText("1 个标记");

    // E. A reference role on the photo layer.
    await tab("图层");
    await inspector.getByRole("button", { name: "选择图层 photo" }).click();
    await tab("属性");
    await inspector.getByRole("group", { name: "作为参考" }).getByRole("button", { name: "保留风格" }).click();
    await expect(attached).toContainText("参考 photo · 保留风格");

    // A user font on the headline: Latin from the font, CJK from the built-in fallback.
    await tab("图层");
    await inspector.getByRole("button", { name: "选择图层 春日上新 SALE" }).click();
    await tab("属性");
    await inspector.locator("input[type=file]").setInputFiles(fontFixture);
    await expectRevision(page, 9);
    await expect(inspector.getByRole("button", { name: "字体" }).first()).toContainText("KaTeX_SansSerif");

    // P4: add an ellipse from 图层 and give it a linear gradient in 属性.
    await tab("图层");
    await inspector.getByRole("group", { name: "添加图层" }).getByRole("button", { name: "添加椭圆" }).click();
    await expectRevision(page, 10);
    await tab("属性");
    await expect(inspector.getByText("椭圆 · ellipse")).toBeVisible();
    await inspector.getByRole("group", { name: "填充" }).getByRole("button", { name: "线性渐变" }).click();
    await expectRevision(page, 11);
    await expect(inspector.getByLabel("角度 °")).toHaveValue("90");

    // F. A derived 4:5 size and one export set with a receipt.
    await tab("导出");
    await inspector.locator("label").filter({ hasText: "4:5" }).click();
    await expect(inspector.getByRole("checkbox", { name: /4:5/u })).toBeChecked();
    await inspector.getByRole("button", { name: "生成 1 个尺寸" }).click();
    await expect(inspector.getByRole("button", { name: "打开「春日茶礼 · 4:5」" })).toBeVisible({ timeout: 30_000 });
    await answerFolder(exports);
    await inspector.getByRole("button", { name: /导出全部尺寸（2 张）/u }).click();
    await expect.poll(async () => (await readdir(exports)).length, { timeout: 30_000 }).toBe(1);
    const [folder] = await readdir(exports);
    const files = (await readdir(join(exports, folder!))).sort();
    expect(files).toHaveLength(3);
    const receipt = JSON.parse(await readFile(join(exports, folder!, "receipt.json"), "utf8")) as { items: { project_id: string; width: number; height: number }[] };
    expect(receipt.items.map(({ width, height }) => `${width}×${height}`)).toEqual(["800×1320", "800×1000"]);

    // The page at three widths and both themes: nothing overflows the window, and each is kept as evidence.
    await tab("属性");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [width, height] of [[1_440, 900], [1_180, 820], [960, 760]] as const) {
        await application.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height); }, { width, height });
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 5_000 }).toBeLessThanOrEqual(width);
        await expect(project.getByRole("button", { name: /^标记/u })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        const path = testInfo.outputPath(`image-project-${scheme}-${width}.png`);
        await page.screenshot({ path });
        await testInfo.attach(`image-project-${scheme}-${width}`, { path, contentType: "image/png" });
      }
    }
  } finally {
    if (application) await application.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
