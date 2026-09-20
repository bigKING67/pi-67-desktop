import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface SelectedKnowledge { id: string; projectId: string; externalRevision: string; }

/** Bounded, transient search receipt; never a replacement for hosted authorization. */
export class SharedKnowledgeSelection {
  private sessionId: string | undefined;
  private generation = 0;
  private selected = new Map<string, SelectedKnowledge>();

  private session(context: ExtensionContext): string {
    const id = context.sessionManager.getSessionId();
    if (!id) throw new Error("Shared knowledge requires an active Pi Session.");
    if (this.sessionId !== id) {
      this.sessionId = id; this.generation++; this.selected.clear();
    }
    return id;
  }

  async search<T extends SelectedKnowledge>(context: ExtensionContext, signal: AbortSignal | undefined,
    limit: number, load: () => Promise<{ items: T[]; total: number }>) {
    const sessionId = this.session(context);
    const generation = ++this.generation; this.selected.clear();
    signal?.throwIfAborted();
    const result = await load();
    signal?.throwIfAborted();
    this.assertCurrent(context, sessionId, generation);
    if (result.items.length > limit || new Set(result.items.map((item) => item.id)).size !== result.items.length) {
      throw new Error("Shared knowledge search returned an invalid selection. Search again.");
    }
    for (const item of result.items) this.selected.set(item.id, {
      id: item.id, projectId: item.projectId, externalRevision: item.externalRevision
    });
    return result;
  }

  async read<T extends SelectedKnowledge>(context: ExtensionContext, signal: AbortSignal | undefined,
    id: string, load: () => Promise<T>): Promise<T> {
    const sessionId = this.session(context), generation = this.generation;
    signal?.throwIfAborted();
    const selected = this.selected.get(id);
    if (!selected) throw new Error("Search shared knowledge in this Session before reading the exact returned id.");
    const item = await load();
    signal?.throwIfAborted();
    this.assertCurrent(context, sessionId, generation);
    if (item.id !== selected.id || item.projectId !== selected.projectId || item.externalRevision !== selected.externalRevision) {
      this.selected.delete(id);
      throw new Error("Shared knowledge changed since search. Search again before reading.");
    }
    return item;
  }

  private assertCurrent(context: ExtensionContext, sessionId: string, generation: number) {
    if (this.session(context) !== sessionId || this.generation !== generation) {
      throw new Error("Shared knowledge selection changed. Search again in the current Session.");
    }
  }
}
