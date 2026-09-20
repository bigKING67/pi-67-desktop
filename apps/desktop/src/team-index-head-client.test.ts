import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { SharedKnowledgeIndexHeadCheck, SharedKnowledgeIndexHeadRequest, SharedKnowledgeIndexHeadResult } from "@pi67/protocol";
import { TeamIndexHeadResponder } from "../../agent-host/src/context/team-index-head-responder.js";
import { TeamIndexHeadClient } from "./team-index-head-client.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(bridge = true) {
  const lifetime = new AbortController(), caller = new AbortController();
  const release = vi.fn(() => lifetime.abort()), assertValid = vi.fn();
  const observe = vi.fn(async (_input: SharedKnowledgeIndexHeadCheck, _signal: AbortSignal) =>
    ({ validUntil: Date.now() + 60_000, signal: lifetime.signal, release, assertValid }));
  const requests: SharedKnowledgeIndexHeadRequest[] = [], results: SharedKnowledgeIndexHeadResult[] = [];
  const host = { postMessage(value: SharedKnowledgeIndexHeadRequest) { requests.push(structuredClone(value)); if (bridge) responder.handleMessage(value); } };
  let current: typeof host | undefined = host;
  const client = new TeamIndexHeadClient(() => current);
  const responder = new TeamIndexHeadResponder({ postMessage(value) { results.push(value); client.handleMessage(host, value); } }, observe);
  const teamId = randomUUID();
  const input = { owner: { endpoint: "https://service.invalid", userId: "user", teamId, scopeKind: "team" as const, scopeId: teamId, localProfileId: "main-only" },
    models: { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } },
    snapshot: { epoch: randomUUID(), cursor: "9007199254740993" }, permissionRevision: "a".repeat(64) };
  const run = () => client.verify(input, caller.signal);
  const reply = (extra: object = {}) => ({ type: "team-index-head-result", requestId: requests[0]!.requestId, ok: true, validUntil: Date.now() + 60_000, ...extra });
  const dispose = () => { client.retire(); responder.shutdown(); };
  return { input, host, client, responder, observe, lifetime, caller, release, assertValid, requests, results, run, reply, dispose,
    replace: () => { current = { postMessage() {} }; } };
}
it("round trips exact metadata and retains a revocable success without private profile data", async () => {
  const f = fixture();
  try {
    const pending = f.run(); f.input.snapshot.cursor = "8"; f.input.models.embedding.model = "mutated";
    const check = await pending; check();
    expect(f.observe.mock.calls[0]?.[0]).toMatchObject({ snapshot: { cursor: "9007199254740993" }, models: { embedding: { model: "embed" } } });
    expect(f.observe.mock.calls[0]?.[0].owner).not.toHaveProperty("localProfileId");
    expect(f.release).not.toHaveBeenCalled();
    f.lifetime.abort(); expect(check).toThrow("unavailable");
    expect(f.results.at(-1)?.type).toBe("team-index-head-invalidated"); expect(f.release).toHaveBeenCalledOnce();
  } finally { f.dispose(); }
});
it.each(["caller", "retire", "replacement", "duplicate", "expiry", "wall-back", "monotonic"])("invalidates an accepted reply on %s", async mode => {
  vi.useFakeTimers(); const f = fixture();
  try {
    const check = await f.run();
    if (mode === "caller") f.caller.abort();
    if (mode === "retire") f.client.retire();
    if (mode === "replacement") f.replace();
    if (mode === "duplicate") f.client.handleMessage(f.host, f.reply());
    if (mode === "expiry") vi.advanceTimersByTime(60_001);
    if (mode === "wall-back") vi.setSystemTime(Date.now() - 1);
    if (mode === "monotonic") vi.spyOn(performance, "now").mockReturnValue(performance.now() + 100_000);
    expect(check).toThrow("unavailable"); expect(f.requests.at(-1)?.type).toBe("team-index-head-cancel");
  } finally { f.dispose(); }
});
it.each(["foreign-host", "wrong-id", "malformed", "no-reply"])("rejects %s and ignores late replies after the Main deadline", async mode => {
  vi.useFakeTimers(); const f = fixture(false);
  try {
    const pending = expect(f.run()).rejects.toThrow("unavailable");
    if (mode === "foreign-host") f.client.handleMessage({ postMessage() {} }, f.reply());
    if (mode === "wrong-id") f.client.handleMessage(f.host, f.reply({ requestId: randomUUID() }));
    if (mode === "malformed") expect(f.client.handleMessage(f.host, f.reply({ token: "synthetic" }))).toBe(false);
    await vi.advanceTimersByTimeAsync(10_001); await pending;
    f.client.handleMessage(f.host, f.reply()); expect(f.requests).toHaveLength(2);
  } finally { f.dispose(); }
});
it.each(["denied", "expired", "send-throw", "pre-abort", "invalid-input"])("fails closed for %s", async mode => {
  const f = fixture(false);
  try {
    if (mode === "send-throw") vi.spyOn(f.host, "postMessage").mockImplementation(() => { throw new Error("synthetic"); });
    if (mode === "pre-abort") f.caller.abort();
    if (mode === "invalid-input") f.input.snapshot.cursor = "0";
    const pending = expect(f.run()).rejects.toThrow("unavailable");
    if (mode === "denied") f.client.handleMessage(f.host, { type: "team-index-head-result", requestId: f.requests[0]!.requestId, ok: false });
    if (mode === "expired") f.client.handleMessage(f.host, f.reply({ validUntil: Date.now() - 1 }));
    await pending;
  } finally { f.dispose(); }
});
it("bounds accepted Main leases at four and releases cancelled slots", async () => {
  const f = fixture(false);
  try {
    const pending = Array.from({ length: 4 }, () => f.run().catch(() => undefined));
    await expect(f.run()).rejects.toThrow(); expect(f.requests).toHaveLength(4);
    f.client.retire(); await Promise.all(pending);
    const next = f.run(); f.client.handleMessage(f.host, { ...f.reply(), requestId: f.requests.at(-1)!.requestId });
    (await next)();
  } finally { f.dispose(); }
});
it.each(["cancel", "timeout", "shutdown"])("holds Host IO slots after %s and discards late completion", async mode => {
  vi.useFakeTimers(); const f = fixture(false);
  const finishes: Array<(value: Awaited<ReturnType<typeof f.observe>>) => void> = [];
  f.observe.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  const request = { ...f.input, owner: { ...f.input.owner }, type: "team-index-head-check" as const, requestId: randomUUID() };
  Reflect.deleteProperty(request.owner, "localProfileId");
  try {
    for (let index = 0; index < 4; index++) {
      request.requestId = randomUUID(); f.responder.handleMessage(request);
      if (mode === "cancel") f.responder.handleMessage({ type: "team-index-head-cancel", requestId: request.requestId });
    }
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(8_001);
    if (mode === "shutdown") f.responder.shutdown();
    f.responder.handleMessage({ ...request, requestId: randomUUID() }); expect(f.observe).toHaveBeenCalledTimes(4);
    expect(f.observe.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
    for (const finish of finishes) finish({ validUntil: Date.now() + 60_000, signal: f.lifetime.signal, release: f.release, assertValid: f.assertValid });
    await Promise.resolve(); await Promise.resolve();
    expect(f.results.some(result => result.type === "team-index-head-result" && result.ok)).toBe(false);
    expect(f.release).toHaveBeenCalledTimes(4);
  } finally { f.dispose(); }
});
it("sanitizes Host observation failures and malformed requests", async () => {
  const f = fixture(); f.observe.mockRejectedValue(new Error("synthetic-private-error"));
  try {
    expect(f.responder.handleMessage({ type: "team-index-head-check", path: "/private" })).toBe(false);
    await expect(f.run()).rejects.toThrow("unavailable");
    expect(f.results).toEqual([{ type: "team-index-head-result", requestId: f.requests[0]!.requestId, ok: false }]);
  } finally { f.dispose(); }
});
it("rejects Main at the Host's 8-second deadline while retaining all unfinished Host slots", async () => {
  vi.useFakeTimers(); const f = fixture();
  const finishes: Array<(value: Awaited<ReturnType<typeof f.observe>>) => void> = [];
  f.observe.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  try {
    const rejected = Array.from({ length: 4 }, () => expect(f.run()).rejects.toThrow("unavailable"));
    await vi.advanceTimersByTimeAsync(7_999); expect(f.results).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await Promise.all(rejected);
    expect(f.results).toHaveLength(4);
    expect(f.results.every(result => result.type === "team-index-head-result" && !result.ok)).toBe(true);
    await expect(f.run()).rejects.toThrow("unavailable"); expect(f.observe).toHaveBeenCalledTimes(4);
    for (const finish of finishes) finish({ validUntil: Date.now() + 60_000, signal: f.lifetime.signal, release: f.release, assertValid: f.assertValid });
    await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.results).toHaveLength(5); expect(f.release).toHaveBeenCalledTimes(4);
  } finally { f.dispose(); }
});
it("does not send a deadline failure after explicit caller cancellation", async () => {
  vi.useFakeTimers(); const f = fixture();
  let finish!: (value: Awaited<ReturnType<typeof f.observe>>) => void;
  f.observe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    const rejected = expect(f.run()).rejects.toThrow("unavailable"); f.caller.abort(); await rejected;
    await vi.advanceTimersByTimeAsync(10_001); expect(f.results).toEqual([]);
    finish({ validUntil: Date.now() + 60_000, signal: f.lifetime.signal, release: f.release, assertValid: f.assertValid });
    await Promise.resolve(); await Promise.resolve(); expect(f.release).toHaveBeenCalledOnce();
    expect(f.results).toEqual([]);
  } finally { f.dispose(); }
});
