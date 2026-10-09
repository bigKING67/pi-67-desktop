import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isImageId, type ImageCandidateListStatus } from "@pi67/domain";
type ImageEngine = typeof import("@pi67/image-engine");
import type { AgentCommand, AgentEvent, CommandResults, ImageCandidateSummary, ImageEventPayloads, ImageProjectSummary } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import type { ImageCommandType } from "./image-command-router.js";
import { imageEngineError } from "./image-engine-errors.js";
import { ImageWorkQueue } from "./image-work-queue.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";

export interface ImageEngineHostDependencies {
  /** Host-local realpath of a registered, trusted Workspace. */
  workspaceRoot(workspaceId: string): string;
  emit(workspaceId: string, event: AgentEvent): void;
  queue?: ImageWorkQueue;
  loadEngine?: () => Promise<ImageEngine>;
  watcher?: ImageProjectWatcher;
}

type Command<T extends ImageCommandType> = AgentCommand<T>;
const event = <T extends keyof ImageEventPayloads>(type: T, payload: ImageEventPayloads[T]): AgentEvent => ({ type, payload }) as AgentEvent;

/**
 * Runs renderer-originated image commands against the engine (ADR 0010).
 * Every change a person makes through the renderer is recorded as `human`;
 * the Agent's changes come through the Pi tools and record `agent`.
 */
export class ImageEngineHost {
  private readonly queue: ImageWorkQueue;
  private readonly watcher: ImageProjectWatcher;
  private engine: Promise<ImageEngine> | undefined;

  constructor(private readonly dependencies: ImageEngineHostDependencies) {
    this.queue = dependencies.queue ?? new ImageWorkQueue();
    this.watcher = dependencies.watcher ?? new ImageProjectWatcher({ emit: (workspaceId, item) => dependencies.emit(workspaceId, item) });
  }

  /** Stops watching project folders; image commands after this still run. */
  dispose(): void { this.watcher.dispose(); }

  // Announces a change this Host made and records it so the watcher stays quiet about it.
  // State the Host returns from list/read is recorded the same way: macOS may replay file
  // events from just before a watch starts, and those must not re-announce known state.
  private announce(workspaceId: string, announced: AgentEvent): void {
    if (announced.type === "image.project.changed") this.watcher.noteRevision(workspaceId, announced.payload.projectId, announced.payload.revision);
    if (announced.type === "image.candidate.changed") this.watcher.noteCandidate(workspaceId, announced.payload.projectId, announced.payload.candidateId, announced.payload.status);
    this.dependencies.emit(workspaceId, announced);
  }

  // The engine (and its native image modules) loads on the first image command,
  // never at Host startup: a missing or broken image runtime must not take
  // conversations down with it. A failed load is retried on the next command.
  private load(): Promise<ImageEngine> {
    this.engine ??= (this.dependencies.loadEngine ?? (() => import("@pi67/image-engine")))().catch((error: unknown) => {
      this.engine = undefined;
      throw new HostCommandError("UNSUPPORTED", "图像引擎在此设备上不可用。", true, { imageReason: "engine_unavailable" }, { cause: error });
    });
    return this.engine;
  }

  async execute<T extends ImageCommandType>(workspaceId: string, command: Command<T>, signal?: AbortSignal): Promise<CommandResults[T]> {
    const cwd = this.dependencies.workspaceRoot(workspaceId);
    const engine = await this.load();
    this.watcher.ensure(workspaceId, cwd, engine);
    try {
      return await this.dispatch(engine, workspaceId, cwd, command as Command<ImageCommandType>, signal) as CommandResults[T];
    } catch (error) {
      throw imageEngineError(error);
    }
  }

  private async dispatch(engine: ImageEngine, workspaceId: string, cwd: string, command: Command<ImageCommandType>, signal: AbortSignal | undefined): Promise<CommandResults[ImageCommandType]> {
    const { acceptCandidate, discardCandidate, editBatch, listCandidates, projectRoot, readProject } = engine;
    switch (command.type) {
      case "image.project.list": {
        const projects = await listProjects(engine, cwd);
        for (const project of projects) this.watcher.noteRevision(workspaceId, project.projectId, project.revision);
        return { projects };
      }
      case "image.project.read": {
        const { projectId, revision } = (command as Command<"image.project.read">).payload;
        const project = await readProject(projectRoot(cwd, projectId), { revision });
        this.watcher.noteRevision(workspaceId, projectId, project.latest_revision);
        return { projectId, revision: project.document.revision, latestRevision: project.latest_revision, sha256: project.sha256, document: project.document };
      }
      case "image.project.edit": {
        const { projectId, baseRevision, summary, operations, dryRun = false } = (command as Command<"image.project.edit">).payload;
        return this.queue.serial(key(workspaceId, projectId), async () => {
          const result = await editBatch(projectRoot(cwd, projectId), { base_revision: baseRevision, author: "human", summary, operations }, { dryRun });
          if (!dryRun) this.announce(workspaceId, event("image.project.changed", { projectId, revision: result.document.revision, sha256: result.sha256, author: "human" }));
          return { projectId, revision: result.document.revision, sha256: result.sha256, dryRun };
        });
      }
      case "image.project.render":
        return this.render(engine, workspaceId, cwd, command as Command<"image.project.render">, signal);
      case "image.candidate.list": {
        const { projectId } = (command as Command<"image.candidate.list">).payload;
        const candidates = (await listCandidates(projectRoot(cwd, projectId))).map((item) => candidateSummary(item));
        for (const candidate of candidates) this.watcher.noteCandidate(workspaceId, projectId, candidate.candidateId, candidate.status);
        return { projectId, candidates };
      }
      case "image.candidate.accept": {
        const { projectId, candidateId, baseRevision, summary } = (command as Command<"image.candidate.accept">).payload;
        return this.queue.serial(key(workspaceId, projectId), async () => {
          const result = await acceptCandidate(projectRoot(cwd, projectId), { candidate_id: candidateId, base_revision: baseRevision, author: "human", summary });
          this.announce(workspaceId, event("image.project.changed", { projectId, revision: result.document.revision, sha256: result.sha256, author: "human" }));
          this.announce(workspaceId, event("image.candidate.changed", { projectId, candidateId, status: "accepted" }));
          return { projectId, revision: result.document.revision, sha256: result.sha256, dryRun: false };
        });
      }
      case "image.candidate.discard": {
        const { projectId, candidateId, summary } = (command as Command<"image.candidate.discard">).payload;
        return this.queue.serial(key(workspaceId, projectId), async () => {
          await discardCandidate(projectRoot(cwd, projectId), { candidate_id: candidateId, author: "human", summary });
          this.announce(workspaceId, event("image.candidate.changed", { projectId, candidateId, status: "discarded" }));
          return { projectId, candidateId, status: "discarded" as const };
        });
      }
    }
  }

  // Renders go to a fresh work folder outside the project, then the PNG moves
  // into the content-addressed preview cache that Main serves by digest.
  private render(engine: ImageEngine, workspaceId: string, cwd: string, command: Command<"image.project.render">, signal: AbortSignal | undefined): Promise<CommandResults["image.project.render"]> {
    const { previewCachePath, projectRoot, renderProject, workDirectory, writeOnce } = engine;
    const { projectId, revision, candidateId, previewMax = 640 } = command.payload;
    const jobId = `render-${randomUUID().slice(0, 8)}`;
    const job = (state: ImageEventPayloads["image.job.changed"]["state"]): void => this.dependencies.emit(workspaceId, event("image.job.changed", { projectId, jobId, kind: "render", state }));
    job("queued");
    return this.queue.serial(key(workspaceId, projectId), () => this.queue.render(async () => {
      const output = await workDirectory(cwd, projectId, "preview");
      try {
        const { receipt } = await renderProject(projectRoot(cwd, projectId), output, { revision, candidateId, previewMax, signal });
        const png = receipt.outputs?.png;
        if (!png) throw new Error("Rendered dimensions mismatch");
        const cached = previewCachePath(cwd, projectId, png.sha256);
        await fs.mkdir(path.dirname(cached), { recursive: true });
        await writeOnce(cached, { source: path.join(output, "image.png") }, { expected: png.sha256 });
        job("completed");
        return { projectId, revision: receipt.revision, ...(candidateId === undefined ? {} : { candidateId }), pngSha256: png.sha256, width: png.width, height: png.height };
      } catch (error) {
        job(signal?.aborted ? "cancelled" : "failed");
        throw error;
      } finally {
        await fs.rm(output, { recursive: true, force: true });
      }
    }, () => job("running"), signal).catch((error: unknown) => {
      // A render cancelled while it waited for a slot never reached the try block above.
      if (signal?.aborted && !(error instanceof HostCommandError)) job("cancelled");
      throw error;
    }));
  }
}

const key = (workspaceId: string, projectId: string): string => `${workspaceId}\u0000${projectId}`;

function candidateSummary(item: Awaited<ReturnType<ImageEngine["listCandidates"]>>[number]): ImageCandidateSummary {
  if (!("candidate" in item)) return { candidateId: item.candidate_id, status: item.status };
  const candidate = item.candidate;
  return {
    candidateId: candidate.id, status: item.status as ImageCandidateListStatus, targetId: candidate.target_id, mode: candidate.mode,
    baseRevision: candidate.base_revision, summary: candidate.summary, outputSha256: candidate.output.sha256, generated: candidate.execution !== undefined,
    ...(candidate.qa ? { protectedChangedPixels: candidate.qa.protected_changed_pixels } : {})
  };
}

/** Every readable project under the Workspace's image folder; unreadable folders are skipped. */
async function listProjects(engine: ImageEngine, cwd: string): Promise<ImageProjectSummary[]> {
  const { listCandidates, projectRoot, projectsDirectory, readProject } = engine;
  let entries: string[];
  try { entries = (await fs.readdir(projectsDirectory(cwd), { withFileTypes: true })).filter((entry) => entry.isDirectory() && isImageId(entry.name)).map((entry) => entry.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const projects: ImageProjectSummary[] = [];
  for (const projectId of entries) {
    const root = projectRoot(cwd, projectId);
    try { await fs.access(path.join(root, "revisions")); } catch { continue; }
    try {
      const project = await readProject(root);
      const latest = path.join(root, "revisions", `${String(project.latest_revision).padStart(6, "0")}.json`);
      const candidates = await listCandidates(root);
      projects.push({ projectId, title: project.document.title, revision: project.document.revision, canvas: project.document.canvas,
        updatedAt: Math.floor((await fs.stat(latest)).mtimeMs), readyCandidates: candidates.filter((item) => item.status === "ready").length });
    } catch { /* A damaged project stays on disk for inspection; it is not listed. */ }
  }
  return projects;
}
