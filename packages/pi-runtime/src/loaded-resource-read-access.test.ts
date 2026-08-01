import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindLoadedResourceReadAccess,
  createLoadedResourceReadAccess,
  refreshLoadedResourceReadAccess
} from "./loaded-resource-read-access.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("LoadedResourceReadAccess", () => {
  it("grants bounded reads for loaded Skills and exact loaded resource files", async () => {
    const fixture = await createFixture();
    const access = createLoadedResourceReadAccess();
    const initialLoader = resourceLoader(fixture);
    await access.refresh(initialLoader);

    expect(access.allows("read", await realpath(fixture.skillFile))).toBe(true);
    expect(access.allows("find", await realpath(fixture.skillDirectory))).toBe(true);
    expect(access.allows("read", await realpath(fixture.promptFile))).toBe(true);
    expect(access.allows("grep", await realpath(fixture.contextFile))).toBe(true);
    expect(access.allows("read", await realpath(fixture.extensionFile))).toBe(true);
    expect(access.allows("write", await realpath(fixture.skillFile))).toBe(false);
    expect(access.allows("ls", await realpath(fixture.promptFile))).toBe(false);
    expect(access.allows("read", await realpath(fixture.unloadedFile))).toBe(false);
  });

  it("does not let a loaded Skill grant follow a symlink outside its canonical root", async () => {
    const fixture = await createFixture();
    const linkedOutside = join(fixture.skillDirectory, "linked-outside.md");
    await symlink(fixture.unloadedFile, linkedOutside);
    const access = createLoadedResourceReadAccess();
    await access.refresh(resourceLoader(fixture));

    expect(access.allows("read", await realpath(linkedOutside))).toBe(false);
  });

  it("replaces grants atomically when the current ResourceLoader reloads", async () => {
    const fixture = await createFixture();
    const access = createLoadedResourceReadAccess();
    const promptFile = fixture.promptFile;
    const loader = resourceLoader(fixture);
    bindLoadedResourceReadAccess(loader, access);
    await access.refresh(loader);
    expect(access.allows("read", await realpath(promptFile))).toBe(true);

    fixture.promptFile = fixture.unloadedFile;
    await refreshLoadedResourceReadAccess(loader);
    expect(access.allows("read", await realpath(promptFile))).toBe(false);
    expect(access.allows("read", await realpath(fixture.unloadedFile))).toBe(true);
  });
});

interface Fixture {
  skillDirectory: string;
  skillFile: string;
  promptFile: string;
  contextFile: string;
  extensionFile: string;
  unloadedFile: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "pi67-loaded-resource-"));
  temporaryDirectories.push(root);
  const skillDirectory = join(root, "skill");
  await mkdir(skillDirectory);
  const fixture = {
    skillDirectory,
    skillFile: join(skillDirectory, "SKILL.md"),
    promptFile: join(root, "prompt.md"),
    contextFile: join(root, "AGENTS.md"),
    extensionFile: join(root, "extension.ts"),
    unloadedFile: join(root, "unloaded.md")
  };
  await Promise.all([
    writeFile(fixture.skillFile, "# Skill"),
    writeFile(fixture.promptFile, "# Prompt"),
    writeFile(fixture.contextFile, "# Context"),
    writeFile(fixture.extensionFile, "export {};"),
    writeFile(fixture.unloadedFile, "# Unloaded")
  ]);
  return fixture;
}

function resourceLoader(fixture: Fixture): ResourceLoader {
  return {
    getSkills: () => ({
      skills: [{
        name: "fixture",
        description: "fixture",
        filePath: fixture.skillFile,
        baseDir: fixture.skillDirectory,
        sourceInfo: { path: fixture.skillFile, source: "fixture", scope: "user", origin: "top-level" },
        disableModelInvocation: false
      }],
      diagnostics: []
    }),
    getPrompts: () => ({
      prompts: [{
        name: "fixture",
        description: "fixture",
        content: "fixture",
        filePath: fixture.promptFile,
        sourceInfo: { path: fixture.promptFile, source: "fixture", scope: "user", origin: "top-level" }
      }],
      diagnostics: []
    }),
    getAgentsFiles: () => ({ agentsFiles: [{ path: fixture.contextFile, content: "fixture" }] }),
    getExtensions: () => ({
      extensions: [{
        path: fixture.extensionFile,
        resolvedPath: fixture.extensionFile,
        sourceInfo: { path: fixture.extensionFile, source: "fixture", scope: "user", origin: "top-level" },
        extension: {},
        hidden: false
      }],
      errors: [],
      runtime: {}
    }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources() {},
    async reload() {}
  } as unknown as ResourceLoader;
}
