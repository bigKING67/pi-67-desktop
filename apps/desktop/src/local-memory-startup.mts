import { writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type Stage = "configuration" | "runtime-admission" | "storage-binding" | "native-start" | "process-ready" | "scope-provisioning";
interface Timing { stage: Stage; outcome: "completed" | "failed"; durationMs: number; }
export interface LocalMemoryStartupReceipt {
  schema: "new-money.local-memory-startup.v1";
  outcome: "completed" | "failed";
  durationMs: number;
  stages: Timing[];
}

/** One launch only. Fixed stages and numeric durations; never accepts error/content payloads. */
export class LocalMemoryStartupTrace {
  readonly #started = performance.now();
  readonly #stages: Timing[] = [];
  async measure<T>(stage: Stage, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let outcome: Timing["outcome"] = "failed";
    try { const value = await action(); outcome = "completed"; return value; }
    finally { this.#stages.push({ stage, outcome, durationMs: Math.max(0, Math.round(performance.now() - started)) }); }
  }
  finish(outcome: Timing["outcome"]): LocalMemoryStartupReceipt {
    return { schema: "new-money.local-memory-startup.v1", outcome,
      durationMs: Math.max(0, Math.round(performance.now() - this.#started)),
      stages: this.#stages.map(stage => ({ ...stage })) };
  }
}

/** Main-owned root; keep only the last launch, atomically, outside the memory data tree. */
export async function writeLocalMemoryStartupReceipt(root: string, receipt: LocalMemoryStartupReceipt) {
  const temporary = join(root, `.startup-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    await rename(temporary, join(root, "startup-diagnostics.json"));
  } finally { await rm(temporary, { force: true }); }
}
