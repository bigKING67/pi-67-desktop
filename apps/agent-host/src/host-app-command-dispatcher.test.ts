import { expect, it, vi } from "vitest";
import { dispatchHostAppCommand } from "./host-app-command-dispatcher.js";
import { toProtocolError } from "./protocol-error.js";

it.each([undefined, "project"])("routes explicit index to the Host owner without loading Pi or changing configuration: %s", async projectId => {
  const signal = new AbortController().signal;
  const result = { state: "published-local" as const, snapshot: { epoch: "epoch", cursor: "1" } };
  const indexKnowledge = vi.fn(async () => result), loadRuntime = vi.fn();
  const dispatchApp = vi.fn();
  const options = { signal, indexKnowledge, loadRuntime, contextMemory: { dispatchApp } } as unknown as Parameters<typeof dispatchHostAppCommand>[1];
  expect(await dispatchHostAppCommand({ type: "enterprise.knowledge.index", payload: { teamId: "team", ...(projectId ? { projectId } : {}) } }, options)).toEqual(result);
  expect(indexKnowledge).toHaveBeenCalledExactlyOnceWith({ teamId: "team", projectId: projectId ?? null, signal });
  expect(loadRuntime).not.toHaveBeenCalled(); expect(dispatchApp).not.toHaveBeenCalled();
});
it("preserves uncertain publication as a non-recoverable protocol outcome", async () => {
  const indexKnowledge = vi.fn(async () => { throw Object.assign(new Error("synthetic lost publication reply"), { outcome: "indeterminate" }); });
  const options = { indexKnowledge } as unknown as Parameters<typeof dispatchHostAppCommand>[1];
  const error = await dispatchHostAppCommand({ type: "enterprise.knowledge.index", payload: { teamId: "team" } }, options).catch((error: unknown) => error);
  expect(toProtocolError(error)).toMatchObject({ code: "RUNTIME_NOT_READY", recoverable: false, details: { outcome: "indeterminate" } });
  expect(indexKnowledge).toHaveBeenCalledOnce();
});
it("does not retry or hide a pre-publication failure", async () => {
  const failed = new Error("synthetic denied"), indexKnowledge = vi.fn(async () => { throw failed; });
  await expect(dispatchHostAppCommand({ type: "enterprise.knowledge.index", payload: { teamId: "team" } },
    { indexKnowledge } as unknown as Parameters<typeof dispatchHostAppCommand>[1])).rejects.toBe(failed);
  expect(indexKnowledge).toHaveBeenCalledOnce();
});
