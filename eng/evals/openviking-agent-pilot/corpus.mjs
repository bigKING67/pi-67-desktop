import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  loadCorpus as loadRetrievalCorpus,
  renderDocument,
} from "../openviking-ab/corpus.mjs";

const scenariosPath = fileURLToPath(new URL("./scenarios.json", import.meta.url));
const agentDistractorIds = new Set(["product-card-low-cvr", "short-video-hook"]);

export function loadAgentPilotCorpus(runId) {
  const scenarioBytes = readFileSync(scenariosPath);
  const scenarios = JSON.parse(scenarioBytes.toString("utf8"));
  const retrieval = loadRetrievalCorpus();
  validateScenarios(scenarios, new Set(retrieval.corpus.documents.map((item) => item.id)));
  const evidenceCodes = Object.fromEntries(retrieval.corpus.documents.map((document) => [
    document.id,
    dynamicEvidenceCode(runId, document.id),
  ]));
  const scenarioDocumentIds = new Set(scenarios.scenarios.flatMap((scenario) => (
    scenario.turns.flatMap((turn) => turn.documentId ? [turn.documentId] : [])
  )));
  const agentDocuments = retrieval.corpus.documents.filter((document) => (
    scenarioDocumentIds.has(document.id) || agentDistractorIds.has(document.id)
  ));
  const hash = createHash("sha256")
    .update(scenarioBytes)
    .update(retrieval.sha256)
    .update(JSON.stringify(agentDocuments.map((document) => document.id)))
    .digest("hex");
  return {
    scenarios,
    retrieval: retrieval.corpus,
    sha256: hash,
    documents: agentDocuments.map((document) => ({
      id: document.id,
      content: `${renderDocument(document)}\n\n验证代号: ${evidenceCodes[document.id]}\n`,
    })),
    evidenceCodes,
  };
}

export function expectedForTurn(turn, evidenceCodes) {
  if (typeof turn.expectedLiteral === "string") return turn.expectedLiteral;
  const expected = evidenceCodes[turn.documentId];
  if (!expected) throw new Error(`No evidence code for scenario document ${String(turn.documentId)}.`);
  return expected;
}

export function agentRunCount(corpus, repetitions = corpus.scenarios.repetitions) {
  return corpus.scenarios.scenarios.length * corpus.scenarios.profiles.length * repetitions;
}

function dynamicEvidenceCode(runId, documentId) {
  return `PX-${createHash("sha256").update(`${runId}\0${documentId}`).digest("hex").slice(0, 12).toUpperCase()}`;
}

function validateScenarios(value, documentIds) {
  if (value?.schema !== "pi67.openviking-agent-scenarios.v1") {
    throw new Error("Unsupported OpenViking Agent pilot scenario schema.");
  }
  if (!Array.isArray(value.profiles) || value.profiles.join(",") !== "no-memory,official-context,pi67-find-only") {
    throw new Error("Agent pilot profiles must remain frozen and ordered.");
  }
  if (!Array.isArray(value.scenarios) || value.scenarios.length !== 6) {
    throw new Error("Agent pilot requires exactly six scenarios.");
  }
  const ids = new Set();
  for (const scenario of value.scenarios) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(scenario.id ?? "") || ids.has(scenario.id)) {
      throw new Error(`Invalid or duplicate Agent scenario id: ${String(scenario.id)}`);
    }
    ids.add(scenario.id);
    if (!Array.isArray(scenario.turns) || scenario.turns.length < 1 || scenario.turns.length > 2) {
      throw new Error(`Agent scenario ${scenario.id} must contain one or two Turns.`);
    }
    for (const turn of scenario.turns) {
      if (typeof turn.prompt !== "string" || turn.prompt.length < 20) {
        throw new Error(`Agent scenario ${scenario.id} has an invalid prompt.`);
      }
      if (turn.documentId && !documentIds.has(turn.documentId)) {
        throw new Error(`Agent scenario ${scenario.id} references an unknown document.`);
      }
      if (!turn.documentId && typeof turn.expectedLiteral !== "string") {
        throw new Error(`Agent scenario ${scenario.id} has no expected outcome.`);
      }
    }
  }
  const expectedRuns = value.scenarios.length * value.profiles.length * value.repetitions;
  if (expectedRuns !== value.limits?.fullAgentRuns) {
    throw new Error(`Agent pilot run contract drifted: expected ${String(value.limits?.fullAgentRuns)}, found ${expectedRuns}.`);
  }
}
