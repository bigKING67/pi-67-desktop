import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIsolatedProviderEnvironment,
  readControlledToolLifecycle
} from "./real-provider-long-turn-fixture.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe("real Provider long-turn fixture", () => {
  it("inherits only the process keys required to launch Electron", async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), "pi67-provider-env-"));
    temporaryDirectories.push(userDataDirectory);
    const environment = await createIsolatedProviderEnvironment({
      userDataDirectory,
      agentDir: join(userDataDirectory, "agent")
    }, {
      PATH: "/fixture/bin",
      LANG: "zh_CN.UTF-8",
      OPENAI_API_KEY: "must-not-cross",
      ANTHROPIC_API_KEY: "must-not-cross",
      PI67_REAL_PROVIDER_API_KEY: "must-not-cross",
      NODE_OPTIONS: "--inspect"
    });

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      PATH: "/fixture/bin",
      LANG: "zh_CN.UTF-8"
    });
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("PI67_REAL_PROVIDER_API_KEY");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
  });

  it("requires exactly one ordered controlled Tool invocation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-provider-tool-"));
    temporaryDirectories.push(directory);
    const lifecyclePath = join(directory, "lifecycle.txt");
    await writeFile(lifecyclePath, "started:1000\ncompleted:96000\n", "utf8");
    await expect(readControlledToolLifecycle(lifecyclePath)).resolves.toEqual({
      startedAt: 1_000,
      completedAt: 96_000
    });

    await writeFile(
      lifecyclePath,
      "started:1000\ncompleted:96000\nstarted:97000\ncompleted:192000\n",
      "utf8"
    );
    await expect(readControlledToolLifecycle(lifecyclePath)).rejects.toThrow(/exactly one/u);
  });
});
