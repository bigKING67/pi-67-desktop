import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type FeedbackKind = "helpful" | "irrelevant" | "outdated" | "wrong-scope" | "incorrect";

interface FeedbackRecord {
  id: string;
  feedback: FeedbackKind;
}

export function applyRecallFeedback<T extends { uri: string; score: number }>(
  entries: readonly T[],
  peerId: string,
): T[] {
  const feedback = readFeedback();
  const scopeHash = hash(peerId);
  return entries
    .flatMap((entry) => {
      const id = `${scopeHash}.${hash(entry.uri)}`;
      const recorded = feedback.findLast((candidate) => candidate.id === id);
      if (recorded && ["outdated", "wrong-scope", "incorrect"].includes(recorded.feedback)) return [];
      const adjustment = recorded?.feedback === "helpful"
        ? 0.08
        : recorded?.feedback === "irrelevant" ? -0.25 : 0;
      return [{ ...entry, score: clampScore(entry.score + adjustment) }];
    })
    .sort((left, right) => right.score - left.score || left.uri.localeCompare(right.uri));
}

export function recallFeedbackRevision(): string {
  const file = feedbackPath();
  if (!file) return "none";
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "none";
  }
}

function readFeedback(): FeedbackRecord[] {
  const file = feedbackPath();
  if (!file) return [];
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown; records?: unknown };
    if (value.schema !== "pi67.recall-feedback.v1" || !Array.isArray(value.records)) return [];
    return value.records.slice(-1_000).flatMap((record) => {
      if (!record || typeof record !== "object") return [];
      const candidate = record as Record<string, unknown>;
      if (typeof candidate.id !== "string" || !isFeedback(candidate.feedback)) return [];
      return [{ id: candidate.id, feedback: candidate.feedback }];
    });
  } catch {
    return [];
  }
}

function feedbackPath(): string | undefined {
  if (process.env.PI67_RECALL_FEEDBACK_FILE) return process.env.PI67_RECALL_FEEDBACK_FILE;
  const agentDir = process.env.PI_CODING_AGENT_DIR || process.env.PI_AGENT_DIR;
  return agentDir ? join(agentDir, "runtime", "context-recall-feedback.json") : undefined;
}

function isFeedback(value: unknown): value is FeedbackKind {
  return ["helpful", "irrelevant", "outdated", "wrong-scope", "incorrect"].includes(String(value));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
