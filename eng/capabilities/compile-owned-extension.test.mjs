import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { inspectDesktopMemoryOwners } from "../../packages/pi-runtime/src/desktop-memory-owner-preflight.ts";
import { compileOwnedExtension } from "./compile-owned-extension.mjs";
import { prepareOpenVikingPiExtension } from "./prepare-openviking-extension.mjs";
import { treeSha256 } from "./prepared-capabilities-validation.mjs";

const root = resolve(import.meta.dirname, "../..");
const run = promisify(execFile);

describe("compiled Desktop-owned extension closure", () => {
  it("imports actual rules and memory entries outside the checkout without node_modules", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-compiled-closure-"));
    try {
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
      const rules = join(directory, "rules");
      await compileOwnedExtension({
        sourceRoot: join(root, "packages/pi-workspace-resources"),
        entryPath: "extensions/pi-rules-loader/index.ts",
        destination: rules
      });
      const lock = JSON.parse(await readFile(join(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
      const source = lock.sources.find((entry) => entry.id === "openviking-pi-extension");
      const memory = join(directory, "openviking-pi-extension");
      await prepareOpenVikingPiExtension(join(root, source.internalPath), source, memory);
      const manifest = JSON.parse(await readFile(join(memory, "package.json"), "utf8"));
      expect(manifest.pi.extensions).toEqual(["./index.js"]);
      expect(manifest.dependencies.typebox).toBeUndefined();
      expect(await readFile(join(memory, "typebox.LICENSE"), "utf8")).toContain("MIT");
      for (const entry of [join(rules, "index.js"), join(memory, "index.js")]) {
        const result = await run(process.execPath, ["--input-type=module", "-e",
          'const module = await import(process.argv[1]); if (typeof module.default !== "function") process.exit(1);',
          pathToFileURL(entry).href
        ], { cwd: directory, env: { ...process.env, NODE_PATH: "" } });
        expect(result.stderr).toBe("");
      }
      await verifyLoaderParity(directory, rules, memory);
      const before = await treeSha256(memory);
      await writeFile(join(memory, "index.js"), "export default () => {};\n");
      expect(await treeSha256(memory)).not.toBe(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a non-built-in import left in generated output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-compiled-invalid-"));
    try {
      await mkdir(join(directory, "output"));
      await writeFile(join(directory, "index.ts"), 'import value from "node:not-a-builtin"; export default value;');
      await expect(compileOwnedExtension({
        sourceRoot: directory, entryPath: "index.ts", destination: join(directory, "output")
      })).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function verifyLoaderParity(directory, rules, memory) {
  const sdk = await import(pathToFileURL(join(root, "packages/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
  const keys = ["PI_CODING_AGENT_DIR", "OPENVIKING_CLI_CONFIG_FILE", "OPENVIKING_CONFIG_FILE"];
  const previous = keys.map((key) => process.env[key]);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("synthetic offline"));
  try {
    for (const state of ["ready", "off", "failed"]) {
      const results = [];
      for (const arm of ["source", "compiled"]) {
        const agentDir = join(directory, `${state}-${arm}`);
        await mkdir(agentDir);
        process.env.PI_CODING_AGENT_DIR = agentDir;
        process.env.OPENVIKING_CLI_CONFIG_FILE = join(agentDir, "absent-cli.json");
        process.env.OPENVIKING_CONFIG_FILE = join(agentDir, "absent-memory.json");
        const config = join(agentDir, "openviking.json");
        await writeFile(config, JSON.stringify({ enabled: state !== "off", privacyMode: "read-only", takeover: { enabled: false } }));
        const eventBus = sdk.createEventBus();
        let connects = 0;
        eventBus.on("pi67:managed-private-memory:connect", ({ accept }) => {
          connects++;
          const profile = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
          accept(state === "failed" ? Promise.reject(new Error("synthetic-secret")) : Promise.resolve({
            endpoint: "http://127.0.0.1:32101", apiKey: "synthetic-only", user: "desktop",
            localProfileId: profile, account: `private-${profile}`
          }));
        });
        const ownership = inspectDesktopMemoryOwners({ cwd: directory, agentDir,
          settingsManager: sdk.SettingsManager.inMemory({ packages: [arm === "source"
            ? join(root, "packages/openviking-pi-extension") : memory] }) });
        expect(ownership.state).toBe("single-owner");
        expect(ownership.selectedOwner).toBe("pi67-openviking");
        expect(ownership.candidates[0].location).toBe(arm === "source"
          ? join(root, "packages/openviking-pi-extension") : memory);
        const paths = arm === "source"
          ? [join(root, "packages/pi-workspace-resources/extensions/pi-rules-loader/index.ts"), join(root, "packages/openviking-pi-extension/index.ts")]
          : [join(rules, "index.js"), join(memory, "index.js")];
        const loader = new sdk.DefaultResourceLoader({ cwd: directory, agentDir,
          settingsManager: sdk.SettingsManager.inMemory({}), noExtensions: true,
          additionalExtensionPaths: paths, eventBus });
        await loader.reload();
        const loaded = loader.getExtensions();
        expect(connects).toBe(state === "off" ? 0 : 1);
        expect(loaded.extensions).toHaveLength(state === "failed" ? 1 : 2);
        expect(loaded.errors.map((entry) => entry.error)).toEqual(state === "failed"
          ? ["Failed to load extension: Managed local memory is unavailable."] : []);
        if (state === "ready") {
          const ctx = { sessionManager: { getCwd: () => directory, getSessionId: () => "synthetic-session", getBranch: () => [] },
            ui: { notify: () => {} } };
          for (const handler of loaded.extensions[1].handlers.get("session_start") ?? []) {
            await handler({ type: "session_start" }, ctx);
          }
        }
        const shape = loaded.extensions.map((entry) => ({
          tools: [...entry.tools.values()].map(({ definition }) => JSON.parse(JSON.stringify(definition))),
          handlers: [...entry.handlers].map(([name, handlers]) => [name, handlers.length]),
          commands: [...entry.commands.keys()], flags: [...entry.flags.keys()], shortcuts: [...entry.shortcuts.keys()]
        }));
        let result;
        if (state === "ready") {
          await writeFile(config, JSON.stringify({ enabled: false, privacyMode: "off" }));
          const tool = loaded.extensions.flatMap((entry) => [...entry.tools.values()])
            .find(({ definition }) => definition.name === "viking_search");
          result = await tool.definition.execute("synthetic", { query: "synthetic" }, new AbortController().signal, () => {}, {});
          expect(result).toEqual({ content: [{ type: "text", text: "OpenViking memory is disabled for this Session." }] });
        }
        results.push({ shape, result });
      }
      expect(results[1]).toEqual(results[0]);
    }
  } finally {
    fetch.mockRestore();
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}
