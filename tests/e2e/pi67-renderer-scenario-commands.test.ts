import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { recordedCommandDetails } from "./pi67-renderer-fixture.js";
import { scenarioCommands } from "./pi67-renderer-scenario-commands.js";

vi.mock("./pi67-renderer-fixture.js", () => ({ recordedCommandDetails: vi.fn() }));

it("excludes recovery inspection but preserves continuation and all turn-producing actions", async () => {
  const commands = [
    { type: "session.recovery.inspect", payload: {} },
    { type: "session.recovery.continue", payload: { anchor: "leaf-1", submissionId: "resume-1" } },
    { type: "prompt.submit", payload: { text: "synthetic prompt" } },
    { type: "plan.implement", payload: { planId: "plan-1" } }
  ].map(command => ({ ...command, hostEpoch: 1 }));
  vi.mocked(recordedCommandDetails).mockResolvedValue(commands);

  expect(await scenarioCommands({} as Page)).toEqual(commands.slice(1));
});
