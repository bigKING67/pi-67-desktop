import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const corpusUrl = new URL("./corpus.json", import.meta.url);

const CASE_TYPES = new Set([
  "direct", "paraphrase", "symptom", "cross-lingual", "distractor", "superseded",
  "follow-up", "task-switch", "multi-target", "actor-peer", "cross-peer", "negative",
]);
const EMPTY_EXPECT_TYPES = new Set(["cross-peer", "negative"]);
const SCOPES = new Set(["user", "actor", "other"]);

export function loadCorpus() {
  const text = readFileSync(corpusUrl, "utf8");
  const corpus = JSON.parse(text);
  validateCorpus(corpus);
  return { corpus, sha256: createHash("sha256").update(text).digest("hex") };
}

export function validateCorpus(corpus) {
  if (corpus?.schema !== "pi67.openviking-recall-baseline-corpus.v1") throw new Error("Unexpected corpus schema.");
  const { account, user, actorPeer, otherPeer } = corpus.identity ?? {};
  for (const value of [account, user, actorPeer, otherPeer]) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(String(value ?? ""))) throw new Error("Invalid corpus identity.");
  }
  if (actorPeer === otherPeer) throw new Error("Actor and other peer must differ.");
  if (!(corpus.trainFraction > 0 && corpus.trainFraction < 1)) throw new Error("Invalid train fraction.");

  const memoryIds = new Set();
  const paths = new Set();
  for (const memory of corpus.memories) {
    if (memoryIds.has(memory.id)) throw new Error(`Duplicate memory ${memory.id}.`);
    memoryIds.add(memory.id);
    if (!SCOPES.has(memory.scope)) throw new Error(`Invalid scope for ${memory.id}.`);
    if (!/^(preferences|entities|events|experiences|cases)\/[a-z0-9/-]+\.md$/u.test(memory.path)) {
      throw new Error(`Invalid memory path for ${memory.id}.`);
    }
    const key = `${memory.scope}:${memory.path}`;
    if (paths.has(key)) throw new Error(`Duplicate memory path ${key}.`);
    paths.add(key);
    if (!memory.body?.trim()) throw new Error(`Empty memory ${memory.id}.`);
  }

  const caseIds = new Set();
  for (const item of corpus.cases) {
    if (caseIds.has(item.id)) throw new Error(`Duplicate case ${item.id}.`);
    caseIds.add(item.id);
    if (!CASE_TYPES.has(item.type)) throw new Error(`Invalid type for ${item.id}.`);
    if (!item.group || !item.query?.trim()) throw new Error(`Incomplete case ${item.id}.`);
    const expectsNothing = EMPTY_EXPECT_TYPES.has(item.type);
    if (expectsNothing !== (item.expect.length === 0)) throw new Error(`Expectation mismatch for ${item.id}.`);
    if (item.type === "multi-target" && item.expect.length < 2) throw new Error(`Multi-target ${item.id} needs 2+ targets.`);
    for (const id of [...item.expect, ...(item.forbid ?? [])]) {
      if (!memoryIds.has(id)) throw new Error(`Unknown memory ${id} in ${item.id}.`);
    }
    for (const id of item.expect) {
      const memory = corpus.memories.find((candidate) => candidate.id === id);
      if (memory.scope === "other") throw new Error(`Case ${item.id} expects another peer's memory.`);
    }
    for (const turn of item.history ?? []) {
      if (!["user", "assistant"].includes(turn.role) || !turn.content?.trim()) throw new Error(`Invalid history in ${item.id}.`);
    }
  }
}

export function memoryUri(corpus, memory) {
  const { user, actorPeer, otherPeer } = corpus.identity;
  const root = memory.scope === "user"
    ? `viking://user/${user}/memories`
    : `viking://user/${user}/peers/${memory.scope === "actor" ? actorPeer : otherPeer}/memories`;
  return `${root}/${memory.path}`;
}

export function otherPeerPrefix(corpus) {
  return `viking://user/${corpus.identity.user}/peers/${corpus.identity.otherPeer}/`;
}

/** Group stratum: negatives and other-peer probes are balanced separately from memory groups. */
function groupStratum(item) {
  if (item.type === "negative") return "negative";
  if (item.type === "cross-peer") return "cross-peer";
  return "memory";
}

/**
 * Deterministic group-level split. Every case of a group lands in the same split,
 * so paraphrases of one memory never straddle train and test. Within each
 * stratum, groups are ordered by a seeded hash and the first share is train.
 */
export function splitGroups(corpus) {
  const strata = new Map();
  for (const item of corpus.cases) {
    const stratum = groupStratum(item);
    const groups = strata.get(stratum) ?? new Set();
    groups.add(item.group);
    strata.set(stratum, groups);
  }
  const assignment = new Map();
  for (const groups of strata.values()) {
    const ordered = [...groups].sort((left, right) => {
      const delta = seededHash(corpus.splitSeed, left).localeCompare(seededHash(corpus.splitSeed, right));
      return delta || left.localeCompare(right);
    });
    const trainCount = Math.max(1, Math.min(ordered.length - 1, Math.round(ordered.length * corpus.trainFraction)));
    ordered.forEach((group, index) => assignment.set(group, index < trainCount ? "train" : "test"));
  }
  return assignment;
}

export function flattenCases(corpus) {
  const split = splitGroups(corpus);
  const uris = new Map(corpus.memories.map((memory) => [memory.id, memoryUri(corpus, memory)]));
  return corpus.cases.map((item) => ({
    ...item,
    split: split.get(item.group),
    history: item.history ?? [],
    forbid: item.forbid ?? [],
    expectedUris: item.expect.map((id) => uris.get(id)),
    forbiddenUris: (item.forbid ?? []).map((id) => uris.get(id)),
  }));
}

function seededHash(seed, value) {
  return createHash("sha256").update(`${seed}\0${value}`).digest("hex");
}
