import { afterEach, expect, it, vi } from "vitest";
import { TeamIndexQuerySessions } from "./team-index-query-sessions.js";

const id = "00000000-0000-4000-8000-000000000001";
const sessions: TeamIndexQuerySessions[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.invalidate(); vi.useRealTimers(); });
function fixture() {
  const readerLife = new AbortController();
  const reader = { models: { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } },
    snapshot: { epoch: id, cursor: "1" }, signal: readerLife.signal,
    assertCurrent: vi.fn(async () => {}), dispose: vi.fn(() => readerLife.abort()),
    queryVector: vi.fn(async () => [{ assetId: id, contentRevision: "a".repeat(64), score: 0.5 }]),
    readDocument: vi.fn(async () => ({ assetId: id, contentRevision: "a".repeat(64), canonicalContent: "synthetic body" })) };
  const runtime = { python: "/synthetic/python", bootstrap: "/synthetic/query.py", assertLaunchable: vi.fn(async () => {}) };
  const prepare = vi.fn<ConstructorParameters<typeof TeamIndexQuerySessions>[0]>(async () => ({ reader, runtime }) as never);
  const prepareRead = vi.fn<NonNullable<ConstructorParameters<typeof TeamIndexQuerySessions>[1]>>(async () => reader as never);
  const report = vi.fn();
  const owner = new TeamIndexQuerySessions(prepare, prepareRead, report); sessions.push(owner);
  const query = async () => {
    const opened = await owner.open(id);
    return { type: "shared-knowledge-index-query" as const, requestId: "query", handleId: id, queryId: opened.queryId, vector: [1, 2, 3, 4], limit: 4 };
  };
  return { owner, reader, readerLife, runtime, prepare, prepareRead, query, report };
}
it("returns metadata only and consumes an exact query once after current-version checks", async () => {
  const f = fixture(), input = await f.query();
  expect(await f.owner.query(input)).toEqual({ snapshot: f.reader.snapshot, hits: [{ assetId: id, contentRevision: "a".repeat(64), score: 0.5 }] });
  expect(f.reader.queryVector).toHaveBeenCalledWith({ vector: [1, 2, 3, 4], limit: 4, runtime: f.runtime });
  expect(f.reader.assertCurrent).toHaveBeenLastCalledWith([{ assetId: id, contentRevision: "a".repeat(64), score: 0.5 }]);
  expect(f.reader.dispose).toHaveBeenCalledOnce(); expect(f.owner.has(id)).toBe(false);
  await expect(f.owner.query(input)).rejects.toThrow();
});
it("preparation returns no executable, directory, extraction model or read grant", async () => {
  const f = fixture(), opened = await f.owner.open(id);
  expect(opened).toEqual({ queryId: expect.any(String), model: f.reader.models.embedding, snapshot: f.reader.snapshot });
  expect(f.reader.queryVector).not.toHaveBeenCalled();
});
it.each(["id", "handle"])("rejects wrong query %s", async kind => {
  const f = fixture(), input = await f.query();
  await expect(f.owner.query({ ...input, ...(kind === "id" ? { queryId: "other" } : { handleId: "other" }) })).rejects.toThrow();
  expect(f.reader.queryVector).not.toHaveBeenCalled();
});
it.each(["cancel", "invalidate", "reader", "timeout", "clock"])("retires an idle reader on %s", async mode => {
  vi.useFakeTimers(); const f = fixture(), input = await f.query();
  if (mode === "cancel") f.owner.cancel(id);
  if (mode === "invalidate") f.owner.invalidate();
  if (mode === "reader") f.readerLife.abort();
  if (mode === "timeout") await vi.advanceTimersByTimeAsync(60_000);
  if (mode === "clock") vi.setSystemTime(Date.now() - 1000);
  await expect(f.owner.query(input)).rejects.toThrow(); expect(f.reader.dispose).toHaveBeenCalledOnce();
});
it("holds cancelled preparation capacity until every late reader has been disposed", async () => {
  const f = fixture(), releases: Array<(value: Awaited<ReturnType<typeof f.prepare>>) => void> = [];
  f.prepare.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
  const pending = Array.from({ length: 4 }, (_, n) => f.owner.open(String(n))), rejected = pending.map(p => expect(p).rejects.toThrow());
  f.owner.invalidate(); await expect(f.owner.open("replacement")).rejects.toThrow(); expect(f.prepare).toHaveBeenCalledTimes(4);
  for (const release of releases) release({ reader: f.reader, runtime: f.runtime } as never);
  await Promise.all(rejected); expect(f.reader.dispose).toHaveBeenCalledTimes(4);
});
it("does not dispose an active reader or free its slot before query settlement", async () => {
  const f = fixture(), input = await f.query(); let release!: (hits: Awaited<ReturnType<typeof f.reader.queryVector>>) => void;
  f.reader.queryVector.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.owner.query(input), rejected = expect(pending).rejects.toThrow();
  f.owner.cancel(id); expect(f.owner.has(id)).toBe(true); expect(f.reader.dispose).not.toHaveBeenCalled();
  await expect(f.owner.open(id)).rejects.toThrow(); await expect(f.owner.query(input)).rejects.toThrow();
  release([]); await rejected; expect(f.reader.dispose).toHaveBeenCalledOnce(); expect(f.owner.has(id)).toBe(false);
});
it.each(["query", "versions"])("rejects %s failure without returning a result", async mode => {
  const f = fixture(), input = await f.query();
  if (mode === "query") f.reader.queryVector.mockRejectedValueOnce(new Error("synthetic-sensitive"));
  else f.reader.assertCurrent.mockRejectedValueOnce(new Error("revoked"));
  await expect(f.owner.query(input)).rejects.toThrow("Team index query unavailable.");
  expect(f.reader.dispose).toHaveBeenCalledOnce(); expect(f.owner.has(id)).toBe(false);
});
const read = { type: "shared-knowledge-index-read" as const, requestId: "read", handleId: id,
  snapshot: { epoch: id, cursor: "1" }, assetId: id, contentRevision: "a".repeat(64) };
it("lets Main select the current snapshot but still reads only the requested asset revision", async () => {
  const f = fixture(); f.reader.snapshot.cursor = "2";
  const result = await f.owner.read({ type: "shared-knowledge-index-read-current", requestId: "read", handleId: id, assetId: id, contentRevision: read.contentRevision });
  expect(result.snapshot).toEqual({ epoch: id, cursor: "2" });
  expect(f.reader.readDocument).toHaveBeenCalledExactlyOnceWith({ assetId: id, contentRevision: read.contentRevision });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.reader.dispose).toHaveBeenCalledOnce();
});
it("reads one exact body and disposes the reader without preparing native runtime", async () => {
  const f = fixture();
  expect(await f.owner.read(read)).toEqual({ snapshot: read.snapshot, assetId: id, contentRevision: read.contentRevision, canonicalContent: "synthetic body" });
  expect(f.reader.readDocument).toHaveBeenCalledWith({ assetId: id, contentRevision: read.contentRevision });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.reader.queryVector).not.toHaveBeenCalled(); expect(f.reader.dispose).toHaveBeenCalledOnce();
});
it.each(["snapshot", "body", "final-check"])("withholds read on %s failure", async mode => {
  const f = fixture();
  if (mode === "body") f.reader.readDocument.mockRejectedValueOnce(new Error("private detail"));
  if (mode === "final-check") f.reader.assertCurrent.mockRejectedValueOnce(new Error("denied"));
  await expect(f.owner.read({ ...read, snapshot: { ...read.snapshot, cursor: mode === "snapshot" ? "2" : "1" } })).rejects.toThrow("unavailable");
  if (mode === "snapshot") expect(f.reader.readDocument).not.toHaveBeenCalled();
  expect(f.reader.dispose).toHaveBeenCalledOnce();
});
it.each(["cancel", "timeout"])("retains read slot until cancelled body replay settles: %s", async mode => {
  vi.useFakeTimers(); const f = fixture(); let release!: (value: Awaited<ReturnType<typeof f.reader.readDocument>>) => void;
  f.reader.readDocument.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.owner.read(read), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.reader.readDocument).toHaveBeenCalledOnce());
  if (mode === "cancel") f.owner.cancel(id); else await vi.advanceTimersByTimeAsync(60_000);
  expect(f.owner.has(id)).toBe(true); expect(f.reader.dispose).not.toHaveBeenCalled();
  await expect(f.owner.open(id)).rejects.toThrow(); await expect(f.owner.read(read)).rejects.toThrow();
  release({ assetId: id, contentRevision: read.contentRevision, canonicalContent: "late" }); await rejected;
  expect(f.owner.has(id)).toBe(false); expect(f.reader.dispose).toHaveBeenCalledOnce();
});
it("shares read and query capacity through late cancelled read admission", async () => {
  const f = fixture(), releases: Array<(reader: Awaited<ReturnType<typeof f.prepareRead>>) => void> = [];
  f.prepareRead.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
  const pending = Array.from({ length: 4 }, (_, n) => f.owner.read({ ...read, handleId: String(n) })), rejected = pending.map(p => expect(p).rejects.toThrow());
  f.owner.invalidate(); await expect(f.owner.open("extra")).rejects.toThrow(); await expect(f.owner.read(read)).rejects.toThrow();
  for (const release of releases) release(f.reader as never); await Promise.all(rejected); expect(f.reader.dispose).toHaveBeenCalledTimes(4);
});
it.each(["reader-admission", "local-body-read", "current-check", "completed"])("records the exact read failure phase without bodies or identifiers: %s", async stage => {
  const f = fixture();
  if (stage === "reader-admission") f.prepareRead.mockRejectedValueOnce(new Error("private token"));
  if (stage === "local-body-read") f.reader.readDocument.mockRejectedValueOnce(new Error("private body"));
  if (stage === "current-check") f.reader.assertCurrent.mockRejectedValueOnce(new Error("private authorization"));
  const result = f.owner.read(read);
  if (stage === "completed") await result; else await expect(result).rejects.toThrow("unavailable");
  expect(f.report).toHaveBeenCalledOnce();
  const diagnostic = f.report.mock.calls[0]![0];
  const phases = ["reader-admission", "local-body-read", "current-check"];
  expect(diagnostic).toEqual({ schema: "new-money.team-read.v1", outcome: stage === "completed" ? "completed" : "failed",
    durationMs: expect.any(Number), stages: phases.slice(0, stage === "completed" ? 3 : phases.indexOf(stage) + 1).map(stage => ({ stage, durationMs: expect.any(Number) })) });
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|synthetic|00000000|contentRevision|canonicalContent|handleId/);
  expect(f.owner.has(id)).toBe(false);
});
it("keeps successful read and disposal independent of a failing diagnostic sink", async () => {
  const f = fixture(); f.report.mockImplementation(() => { throw new Error("sink failed"); });
  expect((await f.owner.read(read)).canonicalContent).toBe("synthetic body");
  expect(f.reader.dispose).toHaveBeenCalledOnce(); expect(f.owner.has(id)).toBe(false);
});
