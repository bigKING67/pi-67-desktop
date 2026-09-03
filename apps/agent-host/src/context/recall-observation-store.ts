import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  summarizeRecallMetrics,
  type ContextRecallItem,
  type ContextRecallMetrics,
  type RecallFeedbackKind,
  type RecallRoute,
  type RecallSource
} from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";

const MAX_OBSERVATIONS = 500;
const MAX_FEEDBACK = 1_000;
const MAX_FILE_BYTES = 256 * 1_024;
const TARGET_P95_MS = 1_500;

interface SafeDiagnosticItem {
  id: string;
  source: RecallSource;
  score: number;
}

interface SafeDiagnosticRecord {
  kind: "context.recallCompleted";
  at: string;
  state: string;
  durationMs: number;
  count?: number;
  route?: RecallRoute;
  candidateCount?: number;
  selectedCount?: number;
  queryHash?: string;
  sessionIdHash?: string;
  scopeHash?: string;
  items?: SafeDiagnosticItem[];
}

interface RecallFeedbackRecord {
  id: string;
  feedback: RecallFeedbackKind;
  recordedAt: number;
  sessionIdHash?: string;
}

interface RecallFeedbackFile {
  schema: "pi67.recall-feedback.v1";
  records: RecallFeedbackRecord[];
}

export class RecallObservationStore {
  readonly observationPath: string;
  readonly feedbackPath: string;
  private feedbackWriteChain: Promise<void> = Promise.resolve();

  constructor(agentDir: string) {
    this.observationPath = process.env.PI67_CONTEXT_EVENT_LOG
      || join(agentDir, "runtime", "context-recall-observations.ndjson");
    this.feedbackPath = process.env.PI67_RECALL_FEEDBACK_FILE
      || join(agentDir, "runtime", "context-recall-feedback.json");
  }

  async list(input: {
    workspaceId: string;
    actorPeerId: string;
    sessionId?: string;
    limit: number;
  }): Promise<{ items: ContextRecallItem[]; total: number }> {
    const records = await this.readObservations();
    const feedback = await this.readFeedback();
    const scopeHashes = new Set([opaqueHash(input.workspaceId), opaqueHash(input.actorPeerId)]);
    const sessionHash = input.sessionId ? opaqueHash(input.sessionId) : undefined;
    const seen = new Set<string>();
    const items: ContextRecallItem[] = [];
    for (const record of records.toReversed()) {
      if (record.scopeHash && !scopeHashes.has(record.scopeHash)) continue;
      if (sessionHash && record.sessionIdHash && record.sessionIdHash !== sessionHash) continue;
      for (const [index, item] of (record.items ?? []).entries()) {
        const id = record.scopeHash ? `${record.scopeHash}.${item.id}` : item.id;
        if (seen.has(id)) continue;
        seen.add(id);
        const storedFeedback = feedback.records.findLast((entry) => entry.id === id);
        items.push({
          id,
          title: recallTitle(item.source, index),
          summary: "",
          source: item.source,
          scope: item.source === "shared-experience" ? "team" : "workspace",
          score: clampScore(item.score),
          createdAt: safeTimestamp(record.at),
          reason: recallReason(record),
          workspaceId: input.workspaceId,
          ...(record.route === undefined ? {} : { route: record.route }),
          durationMs: Math.max(0, Math.round(record.durationMs)),
          candidateCount: Math.max(0, record.candidateCount ?? record.count ?? 0),
          selectedCount: Math.max(0, record.selectedCount ?? record.items?.length ?? 0),
          ...(storedFeedback === undefined ? {} : { feedback: storedFeedback.feedback })
        });
        if (items.length >= Math.max(1, Math.min(100, input.limit))) {
          return { items, total: items.length };
        }
      }
    }
    return { items, total: items.length };
  }

  async metrics(input: {
    workspaceId: string;
    actorPeerId: string;
    sessionId?: string;
  }): Promise<ContextRecallMetrics> {
    const scopeHashes = new Set([opaqueHash(input.workspaceId), opaqueHash(input.actorPeerId)]);
    const sessionHash = input.sessionId ? opaqueHash(input.sessionId) : undefined;
    const samples = (await this.readObservations())
      .filter((record) => !record.scopeHash || scopeHashes.has(record.scopeHash))
      .filter((record) => !sessionHash || !record.sessionIdHash || record.sessionIdHash === sessionHash)
      .filter((record): record is SafeDiagnosticRecord & { route: RecallRoute } => record.route !== undefined)
      .map((record) => ({
        durationMs: record.durationMs,
        route: record.route,
        selectedCount: record.selectedCount ?? record.items?.length ?? record.count ?? 0
      }));
    return summarizeRecallMetrics(samples, TARGET_P95_MS);
  }

  async recordFeedback(input: {
    id: string;
    feedback: RecallFeedbackKind;
    workspaceId: string;
    actorPeerId: string;
    sessionId?: string;
  }): Promise<RecallFeedbackRecord> {
    const write = this.feedbackWriteChain.then(() => this.recordFeedbackNow(input));
    this.feedbackWriteChain = write.then(() => undefined, () => undefined);
    return write;
  }

  private async recordFeedbackNow(input: {
    id: string;
    feedback: RecallFeedbackKind;
    workspaceId: string;
    actorPeerId: string;
    sessionId?: string;
  }): Promise<RecallFeedbackRecord> {
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/u.test(input.id)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Recall feedback requires an opaque item identifier returned by this Workspace.",
        false
      );
    }
    const scopeHash = input.id.slice(0, 64);
    if (![opaqueHash(input.workspaceId), opaqueHash(input.actorPeerId)].includes(scopeHash)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Recall feedback does not belong to the current Workspace.",
        false
      );
    }
    const itemHash = input.id.slice(65);
    const requestedSessionHash = input.sessionId ? opaqueHash(input.sessionId) : undefined;
    const observation = (await this.readObservations()).findLast((record) =>
      record.scopeHash === scopeHash
      && (!requestedSessionHash || !record.sessionIdHash || record.sessionIdHash === requestedSessionHash)
      && record.items?.some((item) => item.id === itemHash));
    if (!observation) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Recall feedback item is not present in the current Workspace or Session observations.",
        false
      );
    }
    const current = await this.readFeedback();
    const recorded: RecallFeedbackRecord = {
      id: input.id,
      feedback: input.feedback,
      recordedAt: Date.now(),
      ...(requestedSessionHash === undefined ? {} : { sessionIdHash: requestedSessionHash })
    };
    current.records = current.records.filter((entry) => entry.id !== input.id);
    current.records.push(recorded);
    current.records = current.records.slice(-MAX_FEEDBACK);
    await writePrivateJson(this.feedbackPath, current);
    return recorded;
  }

  async applyEnterpriseFeedback<T extends { id: string; score: number }>(
    workspaceId: string,
    provider: "enterprise-experience" | "enterprise-sop",
    items: readonly T[]
  ): Promise<T[]> {
    const feedback = await this.readFeedback();
    const scopeHash = opaqueHash(workspaceId);
    return items
      .flatMap((item) => {
        const id = `${scopeHash}.${opaqueHash(`${provider}:${item.id}`)}`;
        const entry = feedback.records.findLast((candidate) => candidate.id === id);
        if (entry && ["outdated", "wrong-scope", "incorrect"].includes(entry.feedback)) return [];
        const adjustment = entry?.feedback === "helpful" ? 0.08 : entry?.feedback === "irrelevant" ? -0.25 : 0;
        return [{ ...item, score: clampScore(item.score + adjustment) }];
      })
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  }

  async recordEnterprise(input: {
    workspaceId: string;
    sessionId?: string;
    query: string;
    route: "enterprise-experience" | "enterprise-sop";
    durationMs: number;
    candidateCount: number;
    items: ReadonlyArray<{ id: string; score: number }>;
  }): Promise<void> {
    try {
      const scopeHash = opaqueHash(input.workspaceId);
      const source: RecallSource = input.route === "enterprise-sop" ? "resource" : "shared-experience";
      const record: SafeDiagnosticRecord = {
        kind: "context.recallCompleted",
        at: new Date().toISOString(),
        state: input.items.length === 0 ? "tool-empty" : "tool-completed",
        route: input.route,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        candidateCount: Math.max(0, input.candidateCount),
        selectedCount: input.items.length,
        queryHash: opaqueHash(input.query),
        scopeHash,
        ...(input.sessionId === undefined ? {} : { sessionIdHash: opaqueHash(input.sessionId) }),
        items: input.items.slice(0, 8).map((item) => ({
          id: opaqueHash(`${input.route}:${item.id}`),
          source,
          score: clampScore(item.score)
        }))
      };
      await appendObservationFile(this.observationPath, record);
      if ((await stat(this.observationPath)).size > MAX_FILE_BYTES) {
        const records = await this.readObservations();
        await writeObservationFile(this.observationPath, records.slice(-MAX_OBSERVATIONS));
      }
    } catch {
      // Telemetry is observational and must never block a recall result.
    }
  }

  private async readObservations(): Promise<SafeDiagnosticRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.observationPath, "utf8");
    } catch {
      return [];
    }
    if (Buffer.byteLength(raw) > MAX_FILE_BYTES) {
      raw = raw.slice(-MAX_FILE_BYTES);
      raw = raw.slice(Math.max(0, raw.indexOf("\n") + 1));
    }
    return raw
      .split("\n")
      .slice(-MAX_OBSERVATIONS)
      .flatMap((line) => parseObservation(line));
  }

  private async readFeedback(): Promise<RecallFeedbackFile> {
    try {
      const parsed = JSON.parse(await readFile(this.feedbackPath, "utf8")) as Partial<RecallFeedbackFile>;
      if (parsed.schema !== "pi67.recall-feedback.v1" || !Array.isArray(parsed.records)) {
        return emptyFeedback();
      }
      return { schema: "pi67.recall-feedback.v1", records: parsed.records.slice(-MAX_FEEDBACK) };
    } catch {
      return emptyFeedback();
    }
  }
}

function parseObservation(line: string): SafeDiagnosticRecord[] {
  if (!line.trim()) return [];
  try {
    const value = JSON.parse(line) as Partial<SafeDiagnosticRecord>;
    if (value.kind !== "context.recallCompleted"
      || typeof value.at !== "string"
      || typeof value.state !== "string"
      || !Number.isFinite(value.durationMs)) return [];
    const route = isRecallRoute(value.route) ? value.route : undefined;
    const scopeHash = safeHash(value.scopeHash);
    const count = safeCount(value.count, 10_000);
    const candidateCount = safeCount(value.candidateCount, 10_000);
    const selectedCount = safeCount(value.selectedCount, 100);
    const queryHash = safeHash(value.queryHash);
    const sessionIdHash = safeHash(value.sessionIdHash);
    const items = Array.isArray(value.items)
      ? value.items.slice(0, 8).flatMap((item) => normalizeDiagnosticItem(item))
      : [];
    if (items.length > 0 && scopeHash === undefined) return [];
    return [{
      kind: "context.recallCompleted",
      at: value.at,
      state: value.state.slice(0, 128),
      durationMs: Math.max(0, Math.min(600_000, Math.round(value.durationMs!))),
      ...(route === undefined ? {} : { route }),
      ...(count === undefined ? {} : { count }),
      ...(candidateCount === undefined ? {} : { candidateCount }),
      ...(selectedCount === undefined ? {} : { selectedCount }),
      ...(queryHash === undefined ? {} : { queryHash }),
      ...(sessionIdHash === undefined ? {} : { sessionIdHash }),
      ...(scopeHash === undefined ? {} : { scopeHash }),
      ...(items.length === 0 ? {} : { items })
    }];
  } catch {
    return [];
  }
}

function normalizeDiagnosticItem(value: unknown): SafeDiagnosticItem[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Partial<SafeDiagnosticItem>;
  const id = safeHash(item.id);
  if (id === undefined || !isRecallSource(item.source) || !Number.isFinite(item.score)) return [];
  return [{ id, source: item.source, score: clampScore(item.score!) }];
}

function isRecallRoute(value: unknown): value is RecallRoute {
  return [
    "startup-context",
    "scoped-find",
    "find-fast",
    "session-context",
    "find-fallback",
    "cache",
    "enterprise-experience",
    "enterprise-sop"
  ].includes(String(value));
}

function isRecallSource(value: unknown): value is RecallSource {
  return ["private-memory", "private-experience", "shared-experience", "resource"]
    .includes(String(value));
}

function safeHash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

function safeCount(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.round(value)))
    : undefined;
}

function recallTitle(source: RecallSource, index: number): string {
  if (source === "shared-experience") return `团队经验候选 ${index + 1}`;
  if (source === "private-experience") return `私人经验候选 ${index + 1}`;
  if (source === "resource") return `知识 / SOP 候选 ${index + 1}`;
  return `私人记忆候选 ${index + 1}`;
}

function recallReason(record: SafeDiagnosticRecord): string {
  const route = record.route ?? "startup-context";
  const candidates = record.candidateCount ?? record.count ?? 0;
  const selected = record.selectedCount ?? record.items?.length ?? 0;
  return `${route} · ${candidates} 个候选 · 返回 ${selected} 项`;
}

function safeTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
}

function emptyFeedback(): RecallFeedbackFile {
  return { schema: "pi67.recall-feedback.v1", records: [] };
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function writeObservationFile(path: string, records: readonly SafeDiagnosticRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const bounded = Buffer.byteLength(body) <= MAX_FILE_BYTES
    ? body
    : `${records.slice(-Math.floor(MAX_OBSERVATIONS / 2)).map((record) => JSON.stringify(record)).join("\n")}\n`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bounded, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function appendObservationFile(path: string, record: SafeDiagnosticRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function opaqueHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
