import { describe, expect, it } from "vitest";
import { ImageWorkQueue } from "./image-work-queue.js";

const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("image work queue", () => {
  it("runs one project's work in order, even after a failure, while other projects proceed", async () => {
    const queue = new ImageWorkQueue(), order: string[] = [];
    const gate = deferred();
    const first = queue.serial("a", async () => { await gate.promise; order.push("a1"); throw new Error("boom"); });
    const second = queue.serial("a", async () => { order.push("a2"); return 2; });
    const other = queue.serial("b", async () => { order.push("b1"); return "b"; });
    await expect(other).resolves.toBe("b");
    expect(order).toEqual(["b1"]);
    gate.resolve();
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["b1", "a1", "a2"]);
  });

  it("refuses work beyond the per-project and total bounds with a typed error", async () => {
    const queue = new ImageWorkQueue({ perProject: 2, total: 3, renders: 1 });
    const gate = deferred();
    const held = [queue.serial("a", () => gate.promise), queue.serial("a", () => gate.promise)];
    await expect(queue.serial("a", () => Promise.resolve())).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED", details: { imageReason: "queue_full" } });
    held.push(queue.serial("b", () => gate.promise));
    await expect(queue.serial("c", () => Promise.resolve())).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
    gate.resolve(); await Promise.all(held);
    await expect(queue.serial("a", () => Promise.resolve("again"))).resolves.toBe("again");
  });

  it("caps concurrent renders and lets a waiting render be cancelled", async () => {
    const queue = new ImageWorkQueue({ perProject: 8, total: 8, renders: 2 });
    const gate = deferred(); let peak = 0, running = 0;
    const work = async () => { running++; peak = Math.max(peak, running); await gate.promise; running--; };
    const renders = [queue.render(work), queue.render(work)];
    const controller = new AbortController(); let started = false;
    const waiting = queue.render(work, () => { started = true; }, controller.signal);
    await Promise.resolve();
    expect(queue.activeRenders).toBe(2);
    controller.abort(new Error("cancelled by user"));
    await expect(waiting).rejects.toThrow("cancelled by user");
    expect(started).toBe(false);
    const third = queue.render(work);
    gate.resolve(); await Promise.all([...renders, third]);
    expect(peak).toBe(2); expect(queue.activeRenders).toBe(0);
  });

  it("refuses a render whose signal already aborted", async () => {
    const controller = new AbortController(); controller.abort(new Error("gone"));
    await expect(new ImageWorkQueue().render(() => Promise.resolve(1), undefined, controller.signal)).rejects.toThrow("gone");
  });
});
