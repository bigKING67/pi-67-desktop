import { describe, expect, it, vi } from "vitest";
import {
  RepositoryMutationAdmissionError,
  RepositoryMutationScheduler
} from "./repository-mutation-scheduler.js";

describe("RepositoryMutationScheduler", () => {
  it("serializes one Repository while allowing bounded cross-Repository concurrency", async () => {
    const scheduler = new RepositoryMutationScheduler({ globalConcurrency: 2, queueLimit: 8 });
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const operation = (id: string) => scheduler.run(id.split(":")[0]!, async () => {
      started.push(id);
      await new Promise<void>((resolve) => releases.set(id, resolve));
      return id;
    });

    const firstA = operation("repo-a:1");
    const secondA = operation("repo-a:2");
    const firstB = operation("repo-b:1");
    await Promise.resolve();
    expect(started).toEqual(["repo-a:1", "repo-b:1"]);

    releases.get("repo-a:1")?.();
    await firstA;
    await Promise.resolve();
    expect(started).toEqual(["repo-a:1", "repo-b:1", "repo-a:2"]);
    releases.get("repo-a:2")?.();
    releases.get("repo-b:1")?.();
    await expect(Promise.all([secondA, firstB])).resolves.toEqual(["repo-a:2", "repo-b:1"]);
  });

  it("rejects bounded overflow and fail-closes a fenced Repository", async () => {
    const scheduler = new RepositoryMutationScheduler({ globalConcurrency: 1, queueLimit: 1 });
    let release: (() => void) | undefined;
    const active = scheduler.run("repo-a", () => new Promise<void>((resolve) => { release = resolve; }));
    const queued = scheduler.run("repo-b", async () => undefined);
    expect(scheduler.diagnostics()).toEqual({
      queuedCount: 1,
      runningCount: 1,
      activeRepositoryCount: 1,
      fencedRepositoryCount: 0,
      disposed: false
    });
    await expect(scheduler.run("repo-c", async () => undefined)).rejects.toMatchObject({ code: "queue-full" });

    scheduler.fence("repo-b");
    expect(scheduler.diagnostics()).toMatchObject({ queuedCount: 0, fencedRepositoryCount: 1 });
    await expect(queued).rejects.toMatchObject({ code: "repository-indeterminate" });
    await expect(scheduler.run("repo-b", async () => undefined)).rejects.toBeInstanceOf(
      RepositoryMutationAdmissionError
    );
    scheduler.clearFence("repo-b");
    release?.();
    await active;
    await expect(scheduler.run("repo-b", async () => "ok")).resolves.toBe("ok");
  });

  it("rejects queued and future work after disposal without interrupting the active callback", async () => {
    const scheduler = new RepositoryMutationScheduler({ globalConcurrency: 1, queueLimit: 2 });
    let release: (() => void) | undefined;
    const active = scheduler.run("repo-a", () => new Promise<string>((resolve) => {
      release = () => resolve("active-finished");
    }));
    const queued = scheduler.run("repo-b", async () => "never");
    scheduler.dispose();
    expect(scheduler.diagnostics()).toMatchObject({
      queuedCount: 0,
      runningCount: 1,
      activeRepositoryCount: 1,
      disposed: true
    });
    await expect(queued).rejects.toMatchObject({ code: "disposed" });
    await expect(scheduler.run("repo-c", async () => "never")).rejects.toMatchObject({ code: "disposed" });
    release?.();
    await expect(active).resolves.toBe("active-finished");
  });

  it("removes an aborted queued mutation without interrupting active Repository work", async () => {
    const scheduler = new RepositoryMutationScheduler({ globalConcurrency: 1, queueLimit: 2 });
    let release: (() => void) | undefined;
    const active = scheduler.run("repo-a", () => new Promise<void>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const operation = vi.fn(async () => "never");
    const queued = scheduler.run("repo-b", operation, controller.signal);

    controller.abort();

    await expect(queued).rejects.toMatchObject({ code: "cancelled" });
    expect(operation).not.toHaveBeenCalled();
    expect(scheduler.diagnostics()).toMatchObject({ queuedCount: 0, runningCount: 1 });
    release?.();
    await active;
  });
});
