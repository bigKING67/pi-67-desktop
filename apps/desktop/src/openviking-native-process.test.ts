import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: native.spawn }));
import { startNativeOpenViking } from "./openviking-native-process.mjs";

const directories: string[] = [];
const model = { protocol: "openai-compatible" as const, endpoint: "http://127.0.0.1:12345/v1", model: "synthetic", apiKey: "synthetic-model-key" };
async function options() {
  const dataRoot = await mkdtemp(join(tmpdir(), "new-money-native-adapter-"));
  directories.push(dataRoot);
  return { python: "/synthetic/python", dataRoot, localProfileId: "12345678-1234-4123-8123-123456789012",
    embedding: { ...model, dimension: 8 }, extraction: { ...model } };
}
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); native.spawn.mockReset();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("native macOS OpenViking adapter", () => {
  it("returns a scoped user key and removes only ephemeral launch files on stop", async () => {
    const configuration = await options();
    configuration.extraction.model = "literal-$NEWMONEY_OV_ROOT_KEY";
    const child = Object.assign(new EventEmitter(), { pid: 12345 });
    native.spawn.mockReturnValue(child);
    vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === "SIGTERM") queueMicrotask(() => child.emit("exit", 0));
      return true;
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (path.endsWith("/health")) return new Response("{}", { status: 200 });
      if (path.endsWith("/users")) return Response.json({ result: { user_key: "scoped-only" } });
      return Response.json({ result: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onExit = vi.fn();
    const handle = await startNativeOpenViking(configuration, new AbortController().signal, onExit);
    expect(handle.connection).toMatchObject({ apiKey: "scoped-only", user: "desktop",
      account: `private-${configuration.localProfileId}`, localProfileId: configuration.localProfileId });
    expect(native.spawn).toHaveBeenCalledWith("/synthetic/python", expect.arrayContaining(["-I", "-B"]),
      expect.objectContaining({ detached: true, stdio: "ignore" }));
    const runDirectory = (await readdir(configuration.dataRoot)).find((name) => name.startsWith(".run-"))!;
    const config = await readFile(join(configuration.dataRoot, runDirectory, "ov.conf"), "utf8");
    expect(config).not.toContain(model.apiKey);
    expect(config).toContain("${NEWMONEY_OV_EMBEDDING_KEY}");
    expect(config).toContain("literal-\\u0024NEWMONEY_OV_ROOT_KEY");
    await handle.stop();
    await handle.stop();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(await readdir(configuration.dataRoot)).toEqual(["data"]);
  });

  it("fails closed before spawn on missing models or canceled startup", async () => {
    const configuration = await options();
    await expect(startNativeOpenViking({ ...configuration, extraction: { ...model, apiKey: "" } },
      new AbortController().signal, () => undefined)).rejects.toThrow(/model configuration/u);
    const controller = new AbortController();
    controller.abort();
    await expect(startNativeOpenViking(configuration, controller.signal, () => undefined)).rejects.toThrow();
    expect(native.spawn).not.toHaveBeenCalled();
  });

  it("cleans a prepared credential file when cancellation wins before spawn", async () => {
    const configuration = await options();
    const controller = new AbortController();
    Object.defineProperty(configuration.extraction, "endpoint", { get() { controller.abort(); return model.endpoint; } });
    await expect(startNativeOpenViking(configuration, controller.signal, () => undefined)).rejects.toThrow();
    expect(native.spawn).not.toHaveBeenCalled();
    expect(await readdir(configuration.dataRoot)).toEqual(["data"]);
  });

  it("cleans up a synchronous launch failure without exposing credentials", async () => {
    const configuration = await options();
    native.spawn.mockImplementation(() => { throw new Error(model.apiKey); });
    await expect(startNativeOpenViking(configuration, new AbortController().signal, () => undefined))
      .rejects.toThrow("Native OpenViking process could not be launched.");
    expect(await readdir(configuration.dataRoot)).toEqual(["data"]);
  });

  it("cleans up a failed spawn without exposing native output or model credentials", async () => {
    const configuration = await options();
    const child = new EventEmitter();
    native.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("synthetic-model-key")));
      return child;
    });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("not-ready"); }));
    const error = await startNativeOpenViking(configuration, new AbortController().signal, () => undefined).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("startup failed");
    expect(message).not.toContain("synthetic-model-key");
    expect(await readdir(configuration.dataRoot)).toEqual(["data"]);
  });
});
