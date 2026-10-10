import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { IMAGE_WORK_DIRECTORY, imageSizePresetLabel, isImageId, type ImageCandidateListStatus, type ImageChangeAuthor, type ImageSizePreset } from "@pi67/domain";
type ImageEngine = typeof import("@pi67/image-engine");
import type { AgentCommand, AgentEvent, CommandPayloads, CommandResults, ImageCandidateReceipt, ImageCandidateSummary, ImageDeriveOutcome, ImageEventPayloads, ImageProjectSummary } from "@pi67/protocol";
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
  /** A verified staged image attachment; absent when the Host has no attachment store. */
  readStagedImage?(id: string): Promise<{ mimeType: string; bytes: Buffer }>;
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
      case "image.project.createFromPhoto":
        return this.createFromPhoto(engine, workspaceId, cwd, (command as Command<"image.project.createFromPhoto">).payload);
      case "image.project.derive":
        return this.derive(engine, workspaceId, cwd, (command as Command<"image.project.derive">).payload);
      case "image.project.read": {
        const { projectId, revision } = (command as Command<"image.project.read">).payload;
        const project = await readProject(projectRoot(cwd, projectId), { revision });
        this.watcher.noteRevision(workspaceId, projectId, project.latest_revision);
        const conversation = await readConversation(cwd, projectId);
        return { ...(conversation ? { conversation } : {}), projectId, revision: project.document.revision, latestRevision: project.latest_revision, sha256: project.sha256, document: project.document };
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
      case "image.project.history": {
        const { projectId } = (command as Command<"image.project.history">).payload;
        const revisions = await engine.projectHistory(projectRoot(cwd, projectId));
        return { projectId, revisions: revisions.map((entry) => ({ revision: entry.revision, author: entry.author as ImageChangeAuthor, summary: entry.summary,
          operationCount: entry.operations.length, ...(entry.candidate_id ? { candidateId: entry.candidate_id } : {}), writtenAt: entry.written_at })) };
      }
      case "image.project.conversation.set": {
        const { projectId, conversation } = (command as Command<"image.project.conversation.set">).payload;
        await readProject(projectRoot(cwd, projectId));
        const file = conversationFile(cwd, projectId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID().slice(0, 8)}.tmp`;
        await fs.writeFile(temporary, `${JSON.stringify(conversation)}\n`, { flag: "wx" });
        await fs.rename(temporary, file);
        return { projectId };
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

  // The photo arrives as a staged attachment (never a renderer path) and is copied into a work
  // folder outside the project; the engine imports it and the work folder is removed.
  private async createFromPhoto(engine: ImageEngine, workspaceId: string, cwd: string,
    { projectId, attachmentId, headline, title }: CommandPayloads["image.project.createFromPhoto"]): Promise<CommandResults["image.project.createFromPhoto"]> {
    if (!this.dependencies.readStagedImage) throw new HostCommandError("UNSUPPORTED", "此设备上不能导入图片附件。", false);
    const staged = await this.dependencies.readStagedImage(attachmentId);
    const extension = PHOTO_EXTENSIONS[staged.mimeType];
    if (!extension) throw new HostCommandError("INVALID_PAYLOAD", "只支持 PNG、JPEG 或 WebP 照片。", false);
    return this.queue.serial(key(workspaceId, projectId), async () => {
      const root = engine.projectRoot(cwd, projectId), work = await engine.workDirectory(cwd, projectId, "import");
      await fs.mkdir(work);
      try {
        const source = path.join(work, `photo.${extension}`);
        await fs.writeFile(source, staged.bytes, { flag: "wx" });
        await engine.ensureProjectParent(root);
        const created = await engine.createPhotoProject(root, { project_id: projectId, source, headline, ...(title ? { title } : {}) });
        this.announce(workspaceId, event("image.project.changed", { projectId, revision: created.document.revision, sha256: created.sha256, author: "human" }));
        return { projectId, revision: created.document.revision, sha256: created.sha256, dryRun: false };
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    });
  }

  // Each preset becomes a sibling project `<source>-<preset>` (then `-2`, `-3`…),
  // re-laid out from the one revision the person was looking at.
  private async derive(engine: ImageEngine, workspaceId: string, cwd: string,
    { projectId, revision, presets }: CommandPayloads["image.project.derive"]): Promise<CommandResults["image.project.derive"]> {
    return this.queue.serial(key(workspaceId, projectId), async () => {
      const root = engine.projectRoot(cwd, projectId);
      const source = await engine.readProject(root, { revision });
      const results: ImageDeriveOutcome[] = [];
      const title = (preset: ImageSizePreset) => `${source.document.title.slice(0, 190)} · ${imageSizePresetLabel(preset)}`;
      // Each preset stands alone: one that fails is reported, and the ones already written stay listed.
      for (const preset of presets) {
        try {
          const result = await this.deriveOne(engine, cwd, root, { revision, sha256: source.sha256, preset, title: title(preset) }, `${projectId.slice(0, 54)}-${preset}`);
          if (result.status === "refused") { results.push({ preset, status: "refused", reason: result.reason }); continue; }
          this.announce(workspaceId, event("image.project.changed", { projectId: result.project_id, revision: 1, sha256: result.sha256, author: "system" }));
          results.push({ preset, status: "derived", projectId: result.project_id, title: title(preset), canvas: result.canvas, shrunkText: result.shrunk.length });
        } catch (error) {
          results.push({ preset, status: "refused", reason: `没能生成：${imageEngineError(error).message}`.slice(0, 500) });
        }
      }
      return { projectId, revision, results };
    });
  }

  // Another writer may claim the free name first (another window, the Agent): take the next one.
  private async deriveOne(engine: ImageEngine, cwd: string, root: string, input: { revision: number; sha256: string; preset: ImageSizePreset; title: string }, base: string) {
    for (let attempt = 0; ; attempt += 1) {
      const derivedId = await freeProjectId(engine, cwd, base);
      const target = engine.projectRoot(cwd, derivedId);
      await engine.ensureProjectParent(target);
      try { return await engine.deriveProject(root, target, { ...input, project_id: derivedId }); }
      catch (error) { if (attempt >= 2 || !(error instanceof Error && error.message === "Derived project already exists")) throw error; }
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

// The project's dock conversation lives beside, not inside, the project (the work folder is disposable state).
const conversationFile = (cwd: string, projectId: string): string => path.join(cwd, ...IMAGE_WORK_DIRECTORY, projectId, "conversation.json");

async function readConversation(cwd: string, projectId: string): Promise<{ sessionPath: string; sessionFileIdentity: string } | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(conversationFile(cwd, projectId), "utf8"));
    const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    return typeof record.sessionPath === "string" && typeof record.sessionFileIdentity === "string" && record.sessionPath.length <= 4096 && record.sessionFileIdentity.length <= 512
      ? { sessionPath: record.sessionPath, sessionFileIdentity: record.sessionFileIdentity } : undefined;
  } catch { return undefined; }
}

/** `base`, or `base-2`, `base-3`… when a project of that name already exists. */
async function freeProjectId(engine: ImageEngine, cwd: string, base: string): Promise<string> {
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? base : `${base}-${index}`;
    try { await fs.lstat(engine.projectRoot(cwd, candidate)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate; throw error; }
  }
  throw new HostCommandError("INVALID_PAYLOAD", "这个尺寸已经派生过太多次，请先整理创作库。", false);
}

const PHOTO_EXTENSIONS: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const key = (workspaceId: string, projectId: string): string => `${workspaceId}\u0000${projectId}`;

function candidateSummary(item: Awaited<ReturnType<ImageEngine["listCandidates"]>>[number]): ImageCandidateSummary {
  if (!("candidate" in item)) return { candidateId: item.candidate_id, status: item.status };
  const candidate = item.candidate;
  return {
    candidateId: candidate.id, status: item.status as ImageCandidateListStatus, targetId: candidate.target_id, mode: candidate.mode,
    baseRevision: candidate.base_revision, summary: candidate.summary, outputSha256: candidate.output.sha256, generated: candidate.execution !== undefined,
    ...(candidate.qa ? { protectedChangedPixels: candidate.qa.protected_changed_pixels } : {}),
    ...(item.receipt ? { receipt: candidateReceipt(item.receipt, candidate.output) } : {})
  };
}

/**
 * The receipt fields a person reads; anything malformed is left out rather than
 * guessed. The size is the candidate's own pixels: a request on the model's grid
 * is resampled to the layer, so the request size would misstate what is accepted.
 */
export function candidateReceipt(receipt: { model: string; parameters: Record<string, unknown>; [key: string]: unknown }, output: { width: number; height: number }): ImageCandidateReceipt {
  const { quality } = receipt.parameters, size = `${output.width}x${output.height}`;
  const duration = Date.parse(String(receipt.completed_at)) - Date.parse(String(receipt.started_at));
  return { model: receipt.model.slice(0, 128),
    ...(typeof quality === "string" && quality.length > 0 && quality.length <= 16 ? { quality } : {}),
    ...(/^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$/u.test(size) ? { size } : {}),
    ...(Number.isFinite(duration) && duration >= 0 && duration <= 86_400_000 ? { durationMs: duration } : {}) };
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
