import type { KnowledgeSyncExpectation } from "@pi67/protocol";
import { receiveSharedKnowledgePage } from "./shared-knowledge-page-receiver.js";
import { SharedKnowledgeReceiptStore } from "./shared-knowledge-receipt-store.js";
import { bindSharedKnowledgeOwner, type SharedKnowledgeReceiptOwner } from "./shared-knowledge-owner.js";
import { materializeSharedKnowledgeProjection, stageSharedKnowledgeProjection } from "./shared-knowledge-projection-stage.js";
export type { SharedKnowledgeReceiptOwner } from "./shared-knowledge-owner.js";

/** One Main-owned instance per exact owner. Inputs must come from trusted Main
 * identity/session state, not an arbitrary Host request. credential.accountId is
 * the active TEAM id; only credential.userId identifies the signed-in user.
 * This namespace binding is not a membership check or permission lease. */
export class SharedKnowledgeReceiptBinding {
  readonly scopeKey: string;
  readonly #owner: Readonly<SharedKnowledgeReceiptOwner>;
  readonly #store: SharedKnowledgeReceiptStore;
  #retired = false;
  readonly #lifetime = new AbortController();
  get signal(): AbortSignal { return this.#lifetime.signal; }

  constructor(root: string, owner: SharedKnowledgeReceiptOwner) {
    const binding = bindSharedKnowledgeOwner(owner);
    this.#owner = binding.owner;
    this.scopeKey = binding.key;
    this.#store = new SharedKnowledgeReceiptStore(root, binding.key);
  }

  /** Main must retire old bindings on logout/account/service/profile changes.
   * Already-started writes may finish in the old namespace, but cannot return a
   * successful receipt through this binding. No files are deleted or migrated. */
  retire(): void { this.#retired = true; this.#lifetime.abort(); }

  async receive(bytes: Uint8Array, expected: KnowledgeSyncExpectation) {
    this.#assertActive();
    if (expected.teamId !== this.#owner.teamId || expected.scopeKind !== this.#owner.scopeKind
        || expected.scopeId !== this.#owner.scopeId) throw new Error("Shared receipt scope binding mismatch.");
    const result = await receiveSharedKnowledgePage(this.#store, bytes, expected);
    this.#assertActive();
    return result;
  }

  async read() {
    this.#assertActive();
    const result = await this.#store.read();
    this.#assertActive();
    return result;
  }

  /** Main-only local replay. The caller must independently hold current read
   * authorization; historical receipt leases never authorize this operation. */
  async materialize(limits: { maxPages: number; maxAssets: number },
    stage: Parameters<typeof materializeSharedKnowledgeProjection>[3], signal: AbortSignal) {
    this.#assertActive();
    const result = await materializeSharedKnowledgeProjection(this.#store, this.#owner, limits, async (version, content) => {
      this.#assertActive(); signal.throwIfAborted();
      await stage(version, content, signal);
      this.#assertActive(); signal.throwIfAborted();
    }, signal);
    this.#assertActive();
    return result;
  }

  /** Metadata-only allowlist; historical page leases do not grant read access. */
  async project(limits: { maxPages: number; maxAssets: number }, signal: AbortSignal) {
    this.#assertActive();
    const result = await stageSharedKnowledgeProjection(this.#store, this.#owner, limits, signal);
    this.#assertActive(); signal.throwIfAborted();
    return result;
  }

  #assertActive(): void {
    if (this.#retired) throw new Error("Shared receipt binding has retired.");
  }
}
