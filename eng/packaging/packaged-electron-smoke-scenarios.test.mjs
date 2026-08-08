import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensurePackagedNewSessionIntent,
  waitForPersistedRuntimeRecovery
} from "./packaged-electron-smoke-scenarios.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true
  })));
});

describe("packaged Workbench runtime recovery", () => {
  it("accepts a materialized recovery record from the current V5 state file", async () => {
    const userDataDirectory = await createUserDataDirectory();
    await writeWorkbenchState(userDataDirectory, "state-v5.json", 5);

    await expect(waitForPersistedRuntimeRecovery(userDataDirectory, 100)).resolves.toBeUndefined();
  });

  it("does not accept the legacy V4 state file as current packaged output", async () => {
    const userDataDirectory = await createUserDataDirectory();
    await writeWorkbenchState(userDataDirectory, "state-v4.json", 4);

    await expect(waitForPersistedRuntimeRecovery(userDataDirectory, 100)).rejects.toThrow(
      "Packaged Workbench did not persist a materialized Session recovery record."
    );
  });

  it("requires the current state version even at the V5 path", async () => {
    const userDataDirectory = await createUserDataDirectory();
    await writeWorkbenchState(userDataDirectory, "state-v5.json", 4);

    await expect(waitForPersistedRuntimeRecovery(userDataDirectory, 100)).rejects.toThrow(
      "Packaged Workbench did not persist a materialized Session recovery record."
    );
  });
});

describe("packaged New Session Intent", () => {
  it.each([false, true])("opens only when the intent is not already visible: %s", async (visible) => {
    const click = vi.fn().mockResolvedValue(undefined);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const intent = { isVisible: vi.fn().mockResolvedValue(visible), waitFor };
    const window = {
      getByTestId: vi.fn().mockReturnValue(intent),
      getByRole: vi.fn().mockReturnValue({ first: () => ({ click }) })
    };

    await ensurePackagedNewSessionIntent(window, 1234);

    expect(click).toHaveBeenCalledTimes(visible ? 0 : 1);
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1234 });
  });
});

async function createUserDataDirectory() {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "pi67-packaged-workbench-"));
  temporaryDirectories.push(userDataDirectory);
  await mkdir(join(userDataDirectory, "workbench"), { recursive: true });
  return userDataDirectory;
}

async function writeWorkbenchState(userDataDirectory, filename, version) {
  await writeFile(join(userDataDirectory, "workbench", filename), JSON.stringify({
    runtimeRecovery: [{
      conversation: {
        kind: "session",
        sessionFileIdentity: "session-fixture.jsonl",
        sessionPath: join(userDataDirectory, "sessions", "session-fixture.jsonl")
      },
      sessionId: "session-fixture"
    }],
    version
  }), "utf8");
}
