import type { FSWatcher } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as engine from "@pi67/image-engine";
import type { AgentCommand, AgentEvent } from "@pi67/protocol";
import { ImageEngineHost } from "./image-engine-host.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";

async function workspaceWithProject(): Promise<{ cwd: string; root: string }> {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-watch-")));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = path.join(cwd, "bg.png");
  await sharp({ create: { width: 128, height: 128, channels: 3, background: "#e4e8dc" } }).png().toFile(source);
  const root = engine.projectRoot(cwd, "poster");
  await fs.mkdir(path.dirname(root), { recursive: true });
  await engine.createProject(root, { project_id: "poster", title: "海报", canvas: { width: 128, height: 128, background: "#ffffff" }, assets: [{ id: "background", source }],
    objects: [{ id: "background", kind: "image", locked: false, visible: true, x: 0, y: 0, width: 128, height: 128, opacity: 1, asset_id: "background", fit: "cover" }] });
  return { cwd, root };
}
const projectEvents = (events: AgentEvent[]) => events.filter((item) => item.type === "image.project.changed").map((item) => item.payload);

describe("image project watcher", { timeout: 60_000 }, () => {
  it("announces changes made outside the Host with their recorded author, and never repeats the Host's own", async () => {
    const { cwd, root } = await workspaceWithProject();
    const events: AgentEvent[] = [];
    const host = new ImageEngineHost({ workspaceRoot: () => cwd, emit: (_id, item) => events.push(item), watcher: new ImageProjectWatcher({ emit: (_id, item) => events.push(item), debounceMs: 30 }) });
    onTestFinished(() => host.dispose());
    await host.execute("w1", { type: "image.project.list", payload: {} } as AgentCommand<"image.project.list">);
    await engine.editBatch(root, { base_revision: 1, author: "agent", summary: "Agent 改背景位置", operations: [{ type: "update_object", id: "background", patch: { x: 0 } }] });
    await vi.waitFor(() => expect(projectEvents(events)).toEqual([expect.objectContaining({ projectId: "poster", revision: 2, author: "agent" })]), { timeout: 5000 });
    await host.execute("w1", { type: "image.project.edit", payload: { projectId: "poster", baseRevision: 2, summary: "人工微调", operations: [{ type: "update_object", id: "background", patch: { opacity: 0.9 } }] } } as AgentCommand<"image.project.edit">);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(projectEvents(events).map((payload) => [payload.revision, payload.author])).toEqual([[2, "agent"], [3, "human"]]);
    const candidate = path.join(cwd, "warm.png");
    await sharp({ create: { width: 128, height: 128, channels: 3, background: "#edd9ce" } }).png().toFile(candidate);
    await engine.stageCandidate(root, { id: "warm", base_revision: 3, target_id: "background", source: candidate, mode: "replace", summary: "暖色" });
    await vi.waitFor(() => expect(events).toContainEqual({ type: "image.candidate.changed", payload: { projectId: "poster", candidateId: "warm", status: "ready" } }), { timeout: 5000 });
  });

  it("debounces bursts, ignores unrelated paths and survives unreadable projects", async () => {
    vi.useFakeTimers(); onTestFinished(() => { vi.useRealTimers(); });
    let listener: ((type: string, name: string | null) => void) | undefined;
    const fake = { close: vi.fn(), on: vi.fn() };
    const emit = vi.fn();
    const watcher = new ImageProjectWatcher({ emit, debounceMs: 50, watch: (_dir, next) => { listener = next; return fake; } });
    const readProject = vi.fn(() => Promise.resolve({ document: { revision: 4, change: { author: "agent" } }, sha256: "s" }));
    const fakeEngine = { projectsDirectory: () => os.tmpdir(), projectRoot: (_cwd: string, id: string) => `/p/${id}`, readProject, listCandidates: () => Promise.resolve([]) } as unknown as typeof engine;
    watcher.ensure("w1", "/cwd", fakeEngine);
    watcher.ensure("w1", "/cwd", fakeEngine);
    for (const name of ["poster/revisions/000004.json", "poster\\revisions\\000004.json", "poster/candidates/x/candidate.json"]) listener?.("rename", name);
    for (const name of [null, "poster/assets/a.png", "../poster/revisions/1.json", "renders/x"]) listener?.("change", name);
    await vi.advanceTimersByTimeAsync(60);
    expect(readProject).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("w1", { type: "image.project.changed", payload: { projectId: "poster", revision: 4, sha256: "s", author: "agent" } });
    readProject.mockRejectedValueOnce(new Error("half written"));
    listener?.("rename", "banner/revisions/000001.json");
    await vi.advanceTimersByTimeAsync(60);
    expect(emit).toHaveBeenCalledTimes(1);
    watcher.dispose();
    expect(fake.close).toHaveBeenCalledTimes(1);
    listener?.("rename", "poster/revisions/000005.json");
    await vi.advanceTimersByTimeAsync(60);
    expect(readProject).toHaveBeenCalledTimes(2);
  });

  it("skips missing folders, respects the workspace cap and stops on watcher errors", () => {
    const handlers: Record<string, () => void> = {};
    const close = vi.fn();
    const fake = { close, on: (name: string, handler: () => void) => { handlers[name] = handler; return fake; } } as unknown as Pick<FSWatcher, "close" | "on">;
    const watch = vi.fn((): Pick<FSWatcher, "close" | "on"> => fake);
    const watcher = new ImageProjectWatcher({ emit: vi.fn(), watch, maxWorkspaces: 1 });
    const at = (dir: string) => ({ projectsDirectory: () => dir }) as unknown as typeof engine;
    watcher.ensure("missing", "/cwd", at("/definitely/missing/image-folder"));
    expect(watch).not.toHaveBeenCalled();
    watcher.ensure("w1", "/cwd", at(os.tmpdir()));
    watcher.ensure("w2", "/cwd", at(os.tmpdir()));
    expect(watch).toHaveBeenCalledTimes(1);
    handlers.error?.();
    expect(close).toHaveBeenCalledTimes(1);
    watcher.ensure("w2", "/cwd", at(os.tmpdir()));
    expect(watch).toHaveBeenCalledTimes(2);
    const throwing = new ImageProjectWatcher({ emit: vi.fn(), watch: () => { throw new Error("unsupported"); } });
    expect(() => throwing.ensure("w1", "/cwd", at(os.tmpdir()))).not.toThrow();
  });
});
