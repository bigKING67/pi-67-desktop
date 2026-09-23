import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readWorkspaceConfigurationBundle,
  readWorkspaceConfigurationBundles,
  type PiConfigurationPaths,
  type WorkspaceConfigurationState
} from "./pi-configuration-file-state.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: vi.fn(original.readFile), stat: vi.fn(original.stat) };
});

let directory: string | undefined;
afterEach(async () => {
  vi.mocked(readFile).mockClear();
  vi.mocked(stat).mockClear();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture() {
  directory = await mkdtemp(join(tmpdir(), "pi67-config-batch-"));
  const paths: PiConfigurationPaths = {
    modelsPath: join(directory, "models.json"),
    authPath: join(directory, "auth.json"),
    globalSettingsPath: join(directory, "settings.json")
  };
  await Promise.all(Object.values(paths).map((path) => writeFile(path, "{}")));
  const states: WorkspaceConfigurationState[] = [];
  for (let index = 0; index < 3; index++) {
    const cwd = join(directory, `workspace-${index}`);
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ synthetic: index }));
    states.push({ cwd, projectTrusted: index !== 2, settingsManager: SettingsManager.inMemory(),
      registrations: 1, listeners: new Set(), runtimes: new Set() });
  }
  vi.mocked(readFile).mockClear();
  vi.mocked(stat).mockClear();
  return { paths, states };
}

function reads(path: string) {
  return vi.mocked(readFile).mock.calls.filter(([file]) => file === path).length;
}

describe("configuration projection batch reads", () => {
  it("reads global files once while keeping project revisions and trust independent", async () => {
    const { paths, states } = await fixture();
    const batch = await readWorkspaceConfigurationBundles(paths, states, 1000);
    for (const path of Object.values(paths)) {
      expect(reads(path)).toBe(1);
      expect(vi.mocked(stat).mock.calls.filter(([file]) => file === path)).toHaveLength(1);
    }
    expect(batch[0]!.revision).not.toBe(batch[1]!.revision);
    for (let index = 0; index < states.length; index++) {
      const project = join(states[index]!.cwd, ".pi/settings.json");
      expect(reads(project)).toBe(index === 2 ? 0 : 1);
      expect(batch[index]!.byKind["project-settings"].content).toBe(index === 2
        ? undefined : JSON.stringify({ synthetic: index }));
      expect(batch[index]).toEqual(await readWorkspaceConfigurationBundle(paths, states[index]!, 1000));
    }
  });

  it("rereads on the next invocation and observes external changes and trust promotion", async () => {
    const { paths, states } = await fixture();
    const before = await readWorkspaceConfigurationBundles(paths, states, 1000);
    await writeFile(paths.modelsPath, '{"providers":{}}');
    states[2]!.projectTrusted = true;
    const after = await readWorkspaceConfigurationBundles(paths, states, 1000);
    expect(reads(paths.modelsPath)).toBe(2);
    for (let index = 0; index < states.length; index++) {
      expect(after[index]!.revision).not.toBe(before[index]!.revision);
      expect(after[index]!.byKind.models.content).toBe('{"providers":{}}');
    }
    expect(after[2]!.byKind["project-settings"].content).toBe('{"synthetic":2}');
  });

  it("propagates a failed global read and retries it on a fresh invocation", async () => {
    const { paths, states } = await fixture();
    await rm(paths.modelsPath);
    await mkdir(paths.modelsPath);
    await expect(readWorkspaceConfigurationBundles(paths, states, 1000)).rejects.toMatchObject({ code: "EISDIR" });
    await rm(paths.modelsPath, { recursive: true });
    await writeFile(paths.modelsPath, "{}");
    await expect(readWorkspaceConfigurationBundles(paths, states, 1000)).resolves.toHaveLength(3);
  });

  it("performs no filesystem work for an empty projection", async () => {
    const { paths } = await fixture();
    await expect(readWorkspaceConfigurationBundles(paths, [], 1000)).resolves.toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });
});
