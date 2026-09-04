import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const corpusPath = fileURLToPath(new URL("./corpus.json", import.meta.url));

export function loadCorpus() {
  const bytes = readFileSync(corpusPath);
  const corpus = JSON.parse(bytes.toString("utf8"));
  validateCorpus(corpus);
  return {
    corpus,
    path: corpusPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function flattenCases(corpus, corpusRoot) {
  return corpus.documents.flatMap((document) => document.queries.map((query, index) => ({
    id: `${document.id}-${index + 1}`,
    query,
    documentId: document.id,
    expectedUri: `${corpusRoot}/${document.id}.md`,
  })));
}

export function renderDocument(document) {
  return [
    `# ${document.title}`,
    "",
    "Trust: synthetic OpenViking A/B retrieval corpus",
    `Document ID: ${document.id}`,
    "",
    document.body,
  ].join("\n");
}

function validateCorpus(corpus) {
  if (corpus?.schema !== "pi67.openviking-ab-corpus.v1") {
    throw new Error("Unsupported OpenViking A/B corpus schema.");
  }
  if (!/^[0-9a-f]{40}$/.test(corpus?.officialUpstream?.commit ?? "")) {
    throw new Error("The official upstream comparison must be pinned to an exact commit.");
  }
  if (!Array.isArray(corpus.documents) || corpus.documents.length < 10) {
    throw new Error("The OpenViking A/B corpus must contain at least ten documents.");
  }
  const ids = new Set();
  let queryCount = 0;
  for (const document of corpus.documents) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(document.id ?? "")) {
      throw new Error(`Invalid synthetic document id: ${String(document.id)}`);
    }
    if (ids.has(document.id)) throw new Error(`Duplicate document id: ${document.id}`);
    ids.add(document.id);
    if (typeof document.title !== "string" || typeof document.body !== "string") {
      throw new Error(`Synthetic document ${document.id} is incomplete.`);
    }
    if (!Array.isArray(document.queries) || document.queries.length < 3) {
      throw new Error(`Synthetic document ${document.id} needs at least three queries.`);
    }
    if (document.queries.some((query) => typeof query !== "string" || query.length < 8)) {
      throw new Error(`Synthetic document ${document.id} has an invalid query.`);
    }
    queryCount += document.queries.length;
  }
  if (queryCount < 60) {
    throw new Error("The retrieval pilot requires at least sixty synthetic queries.");
  }
}
