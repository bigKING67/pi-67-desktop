import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

interface BootstrapFailure {
  kind: "asset" | "pageerror";
  detail: string;
}

test("boots the production Renderer bridge before the full browser suite", async ({ page }, testInfo) => {
  test.setTimeout(15_000);
  await installMockDesktopBridge(page);
  const failures: BootstrapFailure[] = [];
  page.on("pageerror", (error) => failures.push({ kind: "pageerror", detail: error.message }));
  page.on("requestfailed", (request) => {
    if (isCriticalAsset(request.resourceType())) {
      failures.push({ kind: "asset", detail: `${request.url()} (${request.failure()?.errorText ?? "failed"})` });
    }
  });
  page.on("response", (response) => {
    if (isCriticalAsset(response.request().resourceType()) && !response.ok()) {
      failures.push({ kind: "asset", detail: `${response.url()} (${response.status()})` });
    }
  });

  try {
    await page.goto("/");
    await waitForShellOrFailure(page, failures);
    await attachMockAgent(page);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await waitForMockWorkspaceReady(page);
    await page.evaluate(() => (
      window as unknown as {
        __pi67ShutdownCheckpointTest: { request(requestId: string): void };
      }
    ).__pi67ShutdownCheckpointTest.request("checkpoint-bootstrap"));
    await expect.poll(() => page.evaluate(() => (
      window as unknown as {
        __pi67ShutdownCheckpointTest: { acknowledgements: Array<{ requestId: string; succeeded: boolean }> };
      }
    ).__pi67ShutdownCheckpointTest.acknowledgements)).toEqual([
      { requestId: "checkpoint-bootstrap", succeeded: true }
    ]);
    expect(failures, await bootstrapDiagnostics(page, failures)).toEqual([]);
  } catch (error) {
    await testInfo.attach("renderer-bootstrap-diagnostics", {
      body: await bootstrapDiagnostics(page, failures),
      contentType: "text/plain"
    });
    throw error;
  }
});

async function waitForShellOrFailure(page: Page, failures: BootstrapFailure[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (failures.length > 0) throw new Error(`Renderer bootstrap failed: ${failures[0]?.detail}`);
    if (await page.getByRole("button", { name: "选择工作区" }).isVisible().catch(() => false)) return;
    await page.waitForTimeout(50);
  }
  throw new Error("Renderer bootstrap did not expose the Workspace picker within 5 seconds.");
}

async function bootstrapDiagnostics(page: Page, failures: readonly BootstrapFailure[]): Promise<string> {
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector("#root");
    const shell = document.querySelector<HTMLElement>(".application-shell");
    const runtime = document.querySelector<HTMLElement>("[data-runtime-phase]");
    return {
      url: window.location.href,
      title: document.title,
      rootChildCount: root?.childElementCount ?? 0,
      applicationShell: Boolean(shell),
      agentConnected: shell?.dataset.agentConnected ?? "missing",
      runtimePhase: runtime?.dataset.runtimePhase ?? "missing"
    };
  }).catch(() => ({
    url: page.url(),
    title: "unavailable",
    rootChildCount: -1,
    applicationShell: false,
    agentConnected: "unavailable",
    runtimePhase: "unavailable"
  }));
  return [
    ...Object.entries(snapshot).map(([key, value]) => `${key}=${String(value)}`),
    ...failures.slice(0, 5).map((failure, index) => `failure${index + 1}=${failure.kind}:${failure.detail}`)
  ].join("\n");
}

function isCriticalAsset(resourceType: string): boolean {
  return resourceType === "script" || resourceType === "stylesheet" || resourceType === "worker";
}
