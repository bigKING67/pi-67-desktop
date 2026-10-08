import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => { await installMockDesktopBridge(page); });

test("renders the team origin line in the same frame as the transcript", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "检查团队项目的同步状态" }] },
    { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "同步已恢复。" }] }
  ], {}, { memoryOrigin: { kind: "team", teamId: "team-a", projectId: "project-b" } });
  // Sample every frame from before the workspace opens: a transcript without its origin
  // line, or a first message that moves after it appears, is a layout shift. The origin
  // commits with the session snapshot, before the paged transcript arrives.
  await page.evaluate(() => {
    const samples: { origin: boolean; top: number | undefined }[] = [];
    (window as unknown as { __originSamples: typeof samples }).__originSamples = samples;
    const sample = () => {
      const first = document.querySelector("[data-message-id], article");
      if (first) samples.push({
        origin: document.querySelector('[aria-label="会话来源"]') !== null,
        top: first.getBoundingClientRect().top
      });
      if (samples.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("会话来源")).toHaveText("团队会话 · team-a / project-b · 继续处理仍需当前权限");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __originSamples: unknown[] }).__originSamples.length)).toBeGreaterThan(20);
  const samples = await page.evaluate(() => (window as unknown as { __originSamples: { origin: boolean; top: number }[] }).__originSamples);
  expect(samples.every((entry) => entry.origin)).toBe(true);
  expect(new Set(samples.map((entry) => Math.round(entry.top))).size).toBe(1);
});
