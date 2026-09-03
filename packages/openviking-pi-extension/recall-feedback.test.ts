import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRecallFeedback } from "./recall-feedback.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local OpenViking recall feedback", () => {
  it("boosts helpful results and suppresses incorrect results without storing source text", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-recall-feedback-"));
    roots.push(root);
    const file = join(root, "feedback.json");
    const peerId = "peer-a";
    const scope = hash(peerId);
    await writeFile(file, JSON.stringify({
      schema: "pi67.recall-feedback.v1",
      records: [
        { id: `${scope}.${hash("viking://one")}`, feedback: "helpful", recordedAt: 1 },
        { id: `${scope}.${hash("viking://two")}`, feedback: "incorrect", recordedAt: 2 }
      ]
    }), "utf8");
    vi.stubEnv("PI67_RECALL_FEEDBACK_FILE", file);

    expect(applyRecallFeedback([
      { uri: "viking://one", score: 0.6 },
      { uri: "viking://two", score: 0.95 },
      { uri: "viking://three", score: 0.65 }
    ], peerId)).toEqual([
      { uri: "viking://one", score: 0.6799999999999999 },
      { uri: "viking://three", score: 0.65 }
    ]);
  });
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
