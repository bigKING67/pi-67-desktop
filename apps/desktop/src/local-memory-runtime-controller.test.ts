import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalMemoryRuntimeController } from "./local-memory-runtime-controller.js";
const install = vi.hoisted(() => vi.fn());
vi.mock("./openviking-runtime-installer.js", () => ({ installOpenVikingRuntime: install, OPENVIKING_INSTALLATION_NAME: "fixture-runtime",
  OPENVIKING_TEAM_INSTALLATION_NAME: "fixture-runtime-team-index-v1", OPENVIKING_QUERY_INSTALLATION_NAME: "fixture-runtime-team-query-v1" }));
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "memory-controller-")); install.mockReset(); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("Main-owned runtime installation layout", () => {
  it("checks presence without creating directories; installation uses only the fixed target", async () => {
    const controller = new LocalMemoryRuntimeController(root, ["openviking"]);
    expect(await controller.getStatus()).toBe("missing");
    expect(await readdir(root)).toEqual([]);
    await controller.install("/selected/source", new AbortController().signal);
    expect(install).toHaveBeenCalledWith({ source: "/selected/source", parent: join(root, "openviking/runtime"), signal: expect.any(AbortSignal), purpose: "private" });
    await mkdir(join(root, "openviking/runtime/fixture-runtime"));
    expect(await controller.getStatus()).toBe("present");
  });
  it.each(["team-index-v1", "team-query-v1"] as const)("keeps %s presence and installer routing separate from private", async (purpose) => {
    const controller = new LocalMemoryRuntimeController(root, ["openviking"]);
    expect(await controller.getStatus(purpose)).toBe("missing");
    expect(await readdir(root)).toEqual([]);
    await controller.install("/selected/team", new AbortController().signal, purpose);
    expect(install).toHaveBeenCalledWith({ source: "/selected/team", parent: join(root, "openviking/runtime"), signal: expect.any(AbortSignal), purpose });
    await mkdir(join(root, `openviking/runtime/fixture-runtime-${purpose}`));
    expect(await controller.getStatus(purpose)).toBe("present");
    expect(await controller.getStatus()).toBe("missing");
    expect(await controller.getStatus(purpose === "team-index-v1" ? "team-query-v1" : "team-index-v1")).toBe("missing");
  });
  it("rejects linked ancestors before creating or installing anything", async () => {
    const outside = join(root, "outside"); await mkdir(outside);
    await symlink(outside, join(root, "openviking"));
    const controller = new LocalMemoryRuntimeController(root, ["openviking"]);
    await expect(controller.install("/source", new AbortController().signal)).rejects.toThrow("Unsafe");
    expect(await readdir(outside)).toEqual([]); expect(install).not.toHaveBeenCalled();
  });
  it("cancels pending work on shutdown and refuses new work", async () => {
    install.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      signal.throwIfAborted(); await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const controller = new LocalMemoryRuntimeController(root, ["openviking"]);
    const operation = controller.install("/source", new AbortController().signal);
    const rejection = expect(operation).rejects.toBeDefined();
    await expect(controller.install("/team", new AbortController().signal, "team-query-v1")).rejects.toThrow("unavailable");
    await expect(controller.install("/source", new AbortController().signal)).rejects.toThrow("unavailable");
    await controller.stop(); await rejection;
    await expect(controller.install("/source", new AbortController().signal)).rejects.toThrow("unavailable");
  });
  it.each(["..", "a/b", "a\\b", ""])("rejects unsafe layout segment %s", (segment) => {
    expect(() => new LocalMemoryRuntimeController(root, [segment])).toThrow("Invalid");
  });
});
