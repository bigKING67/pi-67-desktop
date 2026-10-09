import { existsSync, watch, type FSWatcher } from "node:fs";
import { isImageId, type ImageCandidateListStatus } from "@pi67/domain";
import type { AgentEvent, ImageEventPayloads } from "@pi67/protocol";

type ImageEngine = typeof import("@pi67/image-engine");
type Watch = (directory: string, listener: (event: string, filename: string | null) => void) => Pick<FSWatcher, "close" | "on">;

export interface ImageProjectWatcherOptions {
  emit(workspaceId: string, event: AgentEvent): void;
  watch?: Watch;
  debounceMs?: number;
  maxWorkspaces?: number;
}

const event = <T extends keyof ImageEventPayloads>(type: T, payload: ImageEventPayloads[T]): AgentEvent => ({ type, payload }) as AgentEvent;
const defaultWatch: Watch = (directory, listener) => watch(directory, { recursive: true, persistent: false }, (type, name) => listener(type, name));

/**
 * Turns changes made outside this Host's own commands (the Agent's Pi tools,
 * Pi TUI, another Desktop) into `image.*` events. Only a newer revision or a
 * changed candidate status produces an event, and the Host records what it
 * already announced, so its own writes are never announced twice. Watching is
 * best-effort: a missing image folder or a watcher error leaves explicit
 * refreshes as the source of truth.
 */
export class ImageProjectWatcher {
  private readonly watchers = new Map<string, Pick<FSWatcher, "close" | "on">>();
  private readonly revisions = new Map<string, number>();
  private readonly candidates = new Map<string, ImageCandidateListStatus>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(private readonly options: ImageProjectWatcherOptions) {}

  ensure(workspaceId: string, cwd: string, engine: ImageEngine): void {
    if (this.disposed || this.watchers.has(workspaceId) || this.watchers.size >= (this.options.maxWorkspaces ?? 16)) return;
    const directory = engine.projectsDirectory(cwd);
    if (!existsSync(directory)) return;
    try {
      const watcher = (this.options.watch ?? defaultWatch)(directory, (_type, filename) => this.changed(workspaceId, cwd, engine, filename));
      watcher.on("error", () => this.stop(workspaceId));
      this.watchers.set(workspaceId, watcher);
    } catch { /* Unsupported or vanished folder: explicit refreshes still work. */ }
  }

  noteRevision(workspaceId: string, projectId: string, revision: number): void {
    const key = projectKey(workspaceId, projectId);
    if ((this.revisions.get(key) ?? 0) < revision) this.revisions.set(key, revision);
  }

  noteCandidate(workspaceId: string, projectId: string, candidateId: string, status: ImageCandidateListStatus): void {
    this.candidates.set(`${projectKey(workspaceId, projectId)}\u0000${candidateId}`, status);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const workspaceId of Array.from(this.watchers.keys())) this.stop(workspaceId);
  }

  private stop(workspaceId: string): void {
    this.watchers.get(workspaceId)?.close();
    this.watchers.delete(workspaceId);
  }

  private changed(workspaceId: string, cwd: string, engine: ImageEngine, filename: string | null): void {
    if (this.disposed || !filename) return;
    const [projectId = "", area] = filename.split(/[\\/]/u);
    if (!isImageId(projectId) || (area !== "revisions" && area !== "candidates")) return;
    const key = projectKey(workspaceId, projectId);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.announce(workspaceId, cwd, engine, projectId);
    }, this.options.debounceMs ?? 200));
  }

  private async announce(workspaceId: string, cwd: string, engine: ImageEngine, projectId: string): Promise<void> {
    const root = engine.projectRoot(cwd, projectId), key = projectKey(workspaceId, projectId);
    try {
      const project = await engine.readProject(root);
      if (this.disposed) return;
      if ((this.revisions.get(key) ?? 0) < project.document.revision) {
        this.revisions.set(key, project.document.revision);
        this.options.emit(workspaceId, event("image.project.changed", { projectId, revision: project.document.revision, sha256: project.sha256, author: project.document.change.author }));
      }
      for (const item of await engine.listCandidates(root)) {
        if (this.disposed) return;
        const candidateId = "candidate" in item ? item.candidate.id : item.candidate_id;
        const candidateKey = `${key}\u0000${candidateId}`;
        if (this.candidates.get(candidateKey) === item.status) continue;
        this.candidates.set(candidateKey, item.status);
        this.options.emit(workspaceId, event("image.candidate.changed", { projectId, candidateId, status: item.status }));
      }
    } catch { /* A half-written or damaged project is announced once it reads cleanly. */ }
  }
}

const projectKey = (workspaceId: string, projectId: string): string => `${workspaceId}\u0000${projectId}`;
