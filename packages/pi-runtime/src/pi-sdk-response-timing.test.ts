import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import { isRuntimeDiagnostics } from "@pi67/protocol";
import { writeResponseTimingFixture } from "../../../eng/performance/response-timing-fixture.js";

it("reports real Pi Session thinking/text and Host emission separately without provider transport", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-response-timing-")));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const extensions = join(agentDir, "extensions");
  await Promise.all([mkdir(cwd), mkdir(extensions, { recursive: true })]);
  await writeResponseTimingFixture(join(extensions, "timing.ts"));
  const runtime = new PiSdkRuntime();
  try {
    await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
    await runtime.selectModel("timing-fixture", "timed");
    await runtime.submitPrompt("synthetic prompt");
    const diagnostics = await runtime.collectDiagnostics();
    expect(isRuntimeDiagnostics(diagnostics)).toBe(true);
    const timing = diagnostics.responseTiming?.receipts[0];
    expect(timing).toMatchObject({ sequence: 1, status: "resolved" });
    expect(timing?.sdkPromptInvokedMs).toBeGreaterThanOrEqual(timing!.configurationReadyMs!);
    expect(timing?.firstThinkingMs).toBeGreaterThanOrEqual(timing!.sdkPromptInvokedMs!);
    expect(timing?.firstTextMs).toBeGreaterThan(timing!.firstThinkingMs!);
    expect(timing?.firstThinkingEmittedMs).toBeGreaterThanOrEqual(timing!.firstThinkingMs!);
    expect(timing?.firstTextEmittedMs).toBeGreaterThanOrEqual(timing!.firstTextMs!);
    expect(JSON.stringify(diagnostics.responseTiming)).not.toMatch(/synthetic|timing-fixture|workspace/u);
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
