import { randomUUID } from "node:crypto";
import { isSharedKnowledgeReceiptRequest, isSharedKnowledgeReceiptResult, KnowledgeSyncValidationError,
  type SharedKnowledgeReceiptRequest, type SharedKnowledgeReceiptResult } from "@pi67/protocol";
import type { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import type { TeamIndexScheduler } from "./team-index-scheduler.js";
import { openPublishedTeamIndex } from "./team-index-reader.js";
import { TeamIndexQuerySessions } from "./team-index-query-sessions.js";
import type { prepareTeamQueryRuntime } from "./team-query-runtime.js";

type Scope = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-receipt-open" }>["scope"];
type BindingLease = ReturnType<EnterpriseCredentialSupervisor["createReceiptBinding"]>;
interface ReceiptGrant { permissionRevision: string; assertValid(): void }
interface Entry { lease: BindingLease; scope: Scope; grant: ReceiptGrant }
interface Opening { scope: Scope; identity: BindingLease["identity"]; denied: boolean }
type ErrorCode = Extract<SharedKnowledgeReceiptResult, { ok: false }>["errorCode"];
type IndexTask = Awaited<ReturnType<TeamIndexScheduler["prepare"]>>;
type VerifiedIndex = Awaited<IndexTask["completion"]>;
interface IndexRun {
  controller: AbortController; id: string; task?: IndexTask; registered: boolean; settled: boolean; reading: boolean;
  publishing: boolean; verified?: VerifiedIndex; timer?: ReturnType<typeof setTimeout>; detach?: () => void;
  expires?: { wall: number; monotonic: number };
}

/** Unconnected private Main broker. Dependencies must resolve Main-owned identity,
 * paths and verified scope authorization. No grant is reconstructed from a Host
 * request or stored page. The dispatcher must bind this instance to one Host. */
export class SharedKnowledgeReceiptBroker {
  readonly #entries = new Map<string, Entry>();
  readonly #authorizations = new Set<AbortController>();
  readonly #opening = new Set<Opening>();
  readonly #indexes = new Map<string, IndexRun>();
  #pending = 0;
  #generation = 0;
  readonly #queries = new TeamIndexQuerySessions(async (handleId, signal) => {
    const configuration = this.dependencies.queryConfiguration?.(), entry = this.#entries.get(handleId);
    if (!configuration || !entry || !entry.lease.isCurrent()) throw new Error("Team query unavailable.");
    const lifetime = AbortSignal.any([signal, entry.lease.binding.signal]);
    const runtime = await configuration.prepareRuntime(lifetime); lifetime.throwIfAborted();
    const reader = await this.openIndexReader(handleId, { memoryRoot: configuration.memoryRoot }, lifetime);
    return { reader, runtime };
  }, async (handleId, signal) => {
    const configuration = this.dependencies.queryConfiguration?.();
    if (!configuration) throw new Error("Team index read unavailable.");
    return this.openIndexReader(handleId, { memoryRoot: configuration.memoryRoot }, signal);
  });
  constructor(private readonly dependencies: {
    createBinding(scope: Scope): BindingLease | undefined;
    authorize(scope: Scope, identity: BindingLease["identity"], signal: AbortSignal): ReceiptGrant | undefined | Promise<ReceiptGrant | undefined>;
    prepareIndex?(this: void, input: Parameters<TeamIndexScheduler["prepare"]>[1]): Promise<IndexTask>;
    queryConfiguration?(this: void): { memoryRoot: string;
      prepareRuntime(signal: AbortSignal): ReturnType<typeof prepareTeamQueryRuntime> } | undefined;
    /** Main-installed observer bound to the current Host, never a request payload.
     * Must verify exact scope/models/head against the supplied fresh permission revision. */
    revalidateIndex?(this: void, input: { owner: BindingLease["owner"]; models: VerifiedIndex["models"];
      snapshot: { epoch: string; cursor: string }; permissionRevision: string }, signal: AbortSignal): Promise<() => void>;
  }) {}

  /** Main-only restored-reader admission. Never route arbitrary Host paths to
   * this method. Query workers and Renderer access need their own narrow seam. */
  async openIndexReader(handleId: string, input: { memoryRoot: string; models?: VerifiedIndex["models"] }, caller: AbortSignal) {
    const entry = this.#entries.get(handleId), observer = this.dependencies.revalidateIndex;
    if (!entry || !observer) throw new Error("Published team index reader unavailable.");
    const models = input.models === undefined ? undefined : structuredClone(input.models), memoryRoot = input.memoryRoot;
    const signal = AbortSignal.any([caller, entry.lease.binding.signal]);
    const current = () => {
      signal.throwIfAborted();
      if (this.#entries.get(handleId) !== entry || !entry.lease.isCurrent()) throw new Error("Published team index reader retired.");
    };
    const authorize = async (operationSignal: AbortSignal) => {
      current();
      const grant = await this.#authorize(entry.scope, entry.lease.identity, operationSignal);
      current(); operationSignal.throwIfAborted();
      if (!grant) { this.#denyScope(entry.scope, entry.lease.identity); throw new Error("Published team index read denied."); }
      if (!/^[a-f0-9]{64}$/u.test(grant.permissionRevision)) throw new Error("Invalid team reader permission revision.");
      assertGrant(grant); return grant;
    };
    let grant: ReceiptGrant | undefined;
    const assertReadable = () => { current(); if (!grant) throw new Error("Team reader has no read grant."); assertGrant(grant); };
    return openPublishedTeamIndex({ memoryRoot, ...(models ? { models } : {}), owner: entry.lease.owner, binding: entry.lease.binding, signal,
      authorize: async operationSignal => { grant = await authorize(operationSignal); return assertReadable; },
      revalidate: async (snapshot, operationSignal, selectedModels) => {
        const next = await authorize(operationSignal);
        const observed = await observer({ owner: entry.lease.owner, models: selectedModels, snapshot, permissionRevision: next.permissionRevision }, operationSignal);
        current(); operationSignal.throwIfAborted(); assertGrant(next); observed(); grant = next;
        return () => { assertReadable(); observed(); };
      } });
  }

  invalidate(): void {
    this.#queries.invalidate();
    this.#generation += 1;
    for (const controller of this.#authorizations) controller.abort();
    for (const index of this.#indexes.values()) index.controller.abort();
    for (const entry of this.#entries.values()) entry.lease.release();
    this.#entries.clear();
  }

  operation(value: unknown): Promise<SharedKnowledgeReceiptResult> | undefined {
    if (!isSharedKnowledgeReceiptRequest(value)) return undefined;
    const message = structuredClone(value);
    if (this.#pending >= 16) return Promise.resolve(failure(message, "CAPACITY_EXCEEDED"));
    this.#pending += 1;
    return this.#run(message).finally(() => { this.#pending -= 1; });
  }

  async #run(message: SharedKnowledgeReceiptRequest): Promise<SharedKnowledgeReceiptResult> {
    if (message.type === "shared-knowledge-receipt-open") return this.#open(message);
    const entry = this.#entries.get(message.handleId);
    if (!entry) return failure(message, "STALE_HANDLE");
    try {
      if (!entry.lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
      if (message.type === "shared-knowledge-receipt-close") {
        this.#remove(message.handleId);
        return { type: "shared-knowledge-receipt-close-result", requestId: message.requestId, ok: true };
      }
      assertGrant(entry.grant);
      if (message.type === "shared-knowledge-index-query-prepare" || message.type === "shared-knowledge-index-query" || message.type === "shared-knowledge-index-read" || message.type === "shared-knowledge-index-read-current") {
        try {
          if (this.#indexes.has(message.handleId)) throw new Error("Receipt handle already owns index work.");
          const result = message.type === "shared-knowledge-index-read" || message.type === "shared-knowledge-index-read-current" ? await this.#queries.read(message) : message.type === "shared-knowledge-index-query-prepare"
            ? await this.#queries.open(message.handleId) : await this.#queries.query(message);
          if (this.#entries.get(message.handleId) !== entry || !entry.lease.isCurrent()) throw new Error("Query receipt retired.");
          assertGrant(entry.grant);
          const response = { type: `${message.type}-result`, requestId: message.requestId, ok: true, ...result };
          if (!isSharedKnowledgeReceiptResult(response)) throw new Error("Invalid query response.");
          return response;
        } catch { this.#queries.cancel(message.handleId); throw new ReceiptFailure("QUERY_FAILED"); }
      }
      if (this.#queries.has(message.handleId)) throw new ReceiptFailure("QUERY_FAILED");
      if (message.type === "shared-knowledge-index-prepare") return await this.#prepareIndex(message, entry);
      if (message.type === "shared-knowledge-index-register" || message.type === "shared-knowledge-index-cancel" || message.type === "shared-knowledge-index-wait" || message.type === "shared-knowledge-index-publish") {
        const index = this.#indexes.get(message.handleId);
        if (!index || index.id !== message.indexId || !index.task || index.controller.signal.aborted) throw new ReceiptFailure("STALE_HANDLE");
        this.#assertIndexCurrent(index);
        if (message.type === "shared-knowledge-index-publish") return await this.#publishIndex(message, entry, index);
        if (message.type === "shared-knowledge-index-wait") {
          if (!index.registered || index.reading) throw new ReceiptFailure("STALE_HANDLE");
          index.reading = true;
          try {
            const verified = await index.task.completion;
            this.#assertIndexCurrent(index);
            if (index.controller.signal.aborted || this.#entries.get(message.handleId) !== entry || !entry.lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
            assertGrant(entry.grant);
            const result = { type: "shared-knowledge-index-wait-result" as const, requestId: message.requestId, ok: true as const,
              state: "verified-unpublished" as const, snapshot: { epoch: verified.snapshot.epoch, cursor: verified.snapshot.cursor } };
            if (!isSharedKnowledgeReceiptResult(result)) throw new ReceiptFailure("INDEX_FAILED");
            index.verified = verified;
            return result;
          } catch (error) {
            index.controller.abort();
            throw error instanceof ReceiptFailure ? error : new ReceiptFailure("INDEX_FAILED");
          }
        }
        if (message.type === "shared-knowledge-index-cancel") {
          index.controller.abort();
        }
        else {
          if (index.registered) { index.controller.abort(); throw new ReceiptFailure("STALE_HANDLE"); }
          index.registered = true;
          try { index.task.register(message.workerRequestId); } catch (error) { index.controller.abort(); throw error; }
        }
        return { type: `${message.type}-result`, requestId: message.requestId, ok: true };
      }
      if (message.permissionRevision !== entry.grant.permissionRevision) throw new ReceiptFailure("SCOPE_DENIED");
      const { page, receipt } = await entry.lease.binding.receive(new TextEncoder().encode(message.pageJson), {
        ...entry.scope, cursor: message.fromCursor, epoch: message.epoch,
        permissionRevision: entry.grant.permissionRevision, limit: 100
      });
      if (this.#entries.get(message.handleId) !== entry || !entry.lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
      assertGrant(entry.grant);
      return { type: "shared-knowledge-receipt-append-result", requestId: message.requestId, ok: true,
        progress: { epoch: receipt?.epoch ?? page.epoch, cursor: receipt?.cursor ?? page.nextCursor } };
    } catch (error) {
      const code = error instanceof ReceiptFailure && error.code === "PUBLICATION_INDETERMINATE" ? error.code
        : !entry.lease.isCurrent() ? "STALE_HANDLE" : classify(error);
      if (code === "STALE_HANDLE" || code === "SCOPE_DENIED") this.#remove(message.handleId);
      return failure(message, code);
    }
  }

  async #prepareIndex(message: Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-prepare" }>, entry: Entry): Promise<SharedKnowledgeReceiptResult> {
    const prepare = this.dependencies.prepareIndex;
    if (!prepare) throw new ReceiptFailure("PERSISTENCE_FAILED");
    if (this.#indexes.has(message.handleId) || this.#indexes.size >= 4) throw new ReceiptFailure("CAPACITY_EXCEEDED");
    const index: IndexRun = { controller: new AbortController(), id: randomUUID(), registered: false, settled: false, reading: false, publishing: false };
    this.#indexes.set(message.handleId, index);
    const signal = AbortSignal.any([index.controller.signal, entry.lease.binding.signal]);
    const assertReadable = () => {
      signal.throwIfAborted();
      if (this.#entries.get(message.handleId) !== entry || !entry.lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
      assertGrant(entry.grant);
    };
    const remove = () => this.#forgetIndex(message.handleId, index);
    const cancel = () => {
      index.task?.cancel();
      if (index.settled && !index.publishing) remove();
    };
    signal.addEventListener("abort", cancel, { once: true });
    index.detach = () => signal.removeEventListener("abort", cancel);
    try {
      assertReadable();
      index.task = await prepare({ owner: entry.lease.owner, binding: entry.lease.binding, models: message.models,
        limits: { maxPages: 100, maxAssets: 100 }, assertReadable, signal });
      // Both unread and wait-consumed results have one non-renewable deadline.
      const settled = () => {
        index.settled = true;
        if (!index.registered || signal.aborted) { if (!index.publishing) remove(); }
        else {
          index.expires = { wall: Date.now() + 90_000, monotonic: performance.now() + 90_000 };
          index.timer = setTimeout(() => index.controller.abort(), 90_000); index.timer.unref?.();
        }
      };
      void index.task.completion.then(settled, settled);
      if (signal.aborted) cancel();
      assertReadable();
      return { type: "shared-knowledge-index-prepare-result", requestId: message.requestId, ok: true, indexId: index.id };
    } catch (error) {
      index.controller.abort();
      if (!index.task) remove();
      throw error;
    }
  }

  async #publishIndex(message: Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-publish" }>, entry: Entry, index: IndexRun): Promise<SharedKnowledgeReceiptResult> {
    const verified = index.verified, revalidate = this.dependencies.revalidateIndex;
    if (!verified || index.publishing) throw new ReceiptFailure("STALE_HANDLE");
    index.publishing = true;
    const signal = AbortSignal.any([index.controller.signal, entry.lease.binding.signal]);
    const check = () => {
      this.#assertIndexCurrent(index);
      signal.throwIfAborted();
      if (this.#entries.get(message.handleId) !== entry || !entry.lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
      assertGrant(entry.grant);
    };
    let committed = false;
    try {
      if (!revalidate) throw new ReceiptFailure("INDEX_FAILED");
      check();
      const published = await verified.publication.publish(async (expected, operationSignal) => {
        check();
        const grant = await this.#authorize(entry.scope, entry.lease.identity, operationSignal);
        check(); operationSignal.throwIfAborted();
        if (!grant) { this.#denyScope(entry.scope, entry.lease.identity); throw new ReceiptFailure("SCOPE_DENIED"); }
        if (!/^[a-f0-9]{64}$/u.test(grant.permissionRevision)) throw new ReceiptFailure("SCOPE_DENIED");
        assertGrant(grant);
        const assertObservation = await revalidate({ owner: entry.lease.owner, models: expected.models,
          snapshot: { epoch: expected.snapshot.epoch, cursor: expected.snapshot.cursor }, permissionRevision: grant.permissionRevision }, operationSignal);
        check(); operationSignal.throwIfAborted(); assertGrant(grant); assertObservation();
        // Renew only after exact current head/model observation succeeds, never
        // on authorization alone or by extending a stored receipt page lease.
        entry.grant = { permissionRevision: grant.permissionRevision, assertValid: () => grant.assertValid() };
        return () => { check(); operationSignal.throwIfAborted(); assertGrant(grant); assertObservation(); };
      }, signal);
      committed = true; check();
      return { type: "shared-knowledge-index-publish-result", requestId: message.requestId, ok: true, state: "published-local",
        snapshot: { epoch: published.pointer.epoch, cursor: published.pointer.cursor } };
    } catch (error) {
      if (committed || error instanceof Error && "outcome" in error && error.outcome === "indeterminate") {
        throw new ReceiptFailure("PUBLICATION_INDETERMINATE");
      }
      throw error instanceof ReceiptFailure ? error : new ReceiptFailure("INDEX_FAILED");
    } finally {
      index.publishing = false; index.controller.abort(); this.#forgetIndex(message.handleId, index);
    }
  }

  #forgetIndex(handleId: string, index: IndexRun): void {
    clearTimeout(index.timer); index.detach?.(); delete index.verified;
    if (this.#indexes.get(handleId) === index) this.#indexes.delete(handleId);
  }

  #assertIndexCurrent(index: IndexRun): void {
    const expires = index.expires;
    if (expires && (Date.now() >= expires.wall || Date.now() < expires.wall - 90_000
      || performance.now() >= expires.monotonic || performance.now() < expires.monotonic - 90_000)) index.controller.abort();
    if (index.controller.signal.aborted) throw new ReceiptFailure("STALE_HANDLE");
  }

  #denyScope(scope: Scope, identity: BindingLease["identity"]): void {
    const denied = { scope, identity };
    for (const other of this.#opening) if (sameScope(denied, other)) other.denied = true;
    for (const [id, entry] of this.#entries) {
      if (sameScope(denied, { scope: entry.scope, identity: entry.lease.identity })) this.#remove(id);
    }
  }

  async #open(message: Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-receipt-open" }>): Promise<SharedKnowledgeReceiptResult> {
    let lease: BindingLease | undefined;
    let opening: Opening | undefined;
    const generation = this.#generation;
    try {
      for (const [id, entry] of this.#entries) {
        if (!entry.lease.isCurrent()) { this.#remove(id); continue; }
        try { assertGrant(entry.grant); } catch { this.#remove(id); }
      }
      if (this.#entries.size + this.#pending > 128) throw new ReceiptFailure("CAPACITY_EXCEEDED");
      lease = this.dependencies.createBinding(message.scope);
      if (!lease) throw new ReceiptFailure("NOT_SIGNED_IN");
      opening = { scope: message.scope, identity: lease.identity, denied: false };
      this.#opening.add(opening);
      const supplied = await this.#authorize(message.scope, lease.identity);
      if (generation !== this.#generation || !lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
      if (!supplied) this.#denyScope(message.scope, lease.identity);
      if (!supplied || opening.denied) throw new ReceiptFailure("SCOPE_DENIED");
      const grant = { permissionRevision: supplied.permissionRevision, assertValid: () => supplied.assertValid() };
      if (!/^[a-f0-9]{64}$/u.test(grant.permissionRevision)) throw new ReceiptFailure("SCOPE_DENIED");
      assertGrant(grant);
      const pointer = await lease.binding.read();
      if (generation !== this.#generation || !lease.isCurrent()) throw new ReceiptFailure("STALE_HANDLE");
      if (opening.denied) throw new ReceiptFailure("SCOPE_DENIED");
      assertGrant(grant);
      const handleId = randomUUID();
      this.#entries.set(handleId, { lease, scope: message.scope, grant });
      return { type: "shared-knowledge-receipt-open-result", requestId: message.requestId, ok: true,
        handleId, userId: lease.identity.userId, endpoint: lease.identity.endpoint,
        progress: { epoch: pointer?.epoch ?? null, cursor: pointer?.cursor ?? "0" } };
    } catch (error) {
      const code = generation !== this.#generation || lease && !lease.isCurrent() ? "STALE_HANDLE" : classify(error);
      lease?.release();
      return failure(message, code);
    } finally { if (opening) this.#opening.delete(opening); }
  }

  async #authorize(scope: Scope, identity: BindingLease["identity"], signal?: AbortSignal): Promise<ReceiptGrant | undefined> {
    const controller = new AbortController();
    this.#authorizations.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8_000);
    timeout.unref?.();
    const retire = () => controller.abort();
    signal?.addEventListener("abort", retire, { once: true });
    if (signal?.aborted) retire();
    let abort: () => void = () => {};
    try {
      return await new Promise<ReceiptGrant | undefined>((resolve, reject) => {
        abort = () => reject(new ReceiptFailure("SCOPE_DENIED"));
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) { abort(); return; }
        // Observe late resolution/rejection even when the provider ignores cancellation.
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return this.dependencies.authorize(scope, identity, controller.signal);
        }).then(resolve, () => reject(new ReceiptFailure("SCOPE_DENIED")));
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", retire);
      controller.signal.removeEventListener("abort", abort);
      this.#authorizations.delete(controller);
    }
  }

  #remove(id: string): void {
    this.#queries.cancel(id);
    const index = this.#indexes.get(id);
    index?.controller.abort();
    this.#entries.get(id)?.lease.release(); this.#entries.delete(id);
  }
}
function sameScope(left: Pick<Opening, "scope" | "identity">, right: Pick<Opening, "scope" | "identity">): boolean {
  return left.identity.userId === right.identity.userId && left.identity.endpoint === right.identity.endpoint
    && left.scope.teamId === right.scope.teamId && left.scope.scopeKind === right.scope.scopeKind && left.scope.scopeId === right.scope.scopeId;
}
class ReceiptFailure extends Error { constructor(readonly code: ErrorCode) { super(code); } }
function assertGrant(grant: ReceiptGrant): void {
  try { grant.assertValid(); } catch { throw new ReceiptFailure("SCOPE_DENIED"); }
}
function classify(error: unknown): ErrorCode {
  if (error instanceof ReceiptFailure) return error.code;
  return error instanceof KnowledgeSyncValidationError ? "INVALID_PAGE" : "PERSISTENCE_FAILED";
}
function failure(message: SharedKnowledgeReceiptRequest, errorCode: ErrorCode): SharedKnowledgeReceiptResult {
  return { type: `${message.type}-result`, requestId: message.requestId, ok: false, errorCode };
}
