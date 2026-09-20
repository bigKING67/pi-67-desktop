/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { applyPrivateRuntimePatch, patchPrivateRuntimeSource } from "./openviking-runtime-patches.mjs";

// Fixture-only routing: OTel remains an experiment; LiteLLM shares the explicit
// private build recipe. No production installation or signing key is used here.
const otelEdits = [
  {
    path: "openviking/metrics/exporters/__init__.py",
    sha256: "e84fc2ff0fd9f236473a5a5982198033814f62e60cac5714496a19ca23c1715f",
    replacements: [["from .otel import OTelMetricExporter\n", ""]],
    suffix: '\n\ndef __getattr__(name):\n    if name == "OTelMetricExporter":\n        from .otel import OTelMetricExporter\n\n        return OTelMetricExporter\n    raise AttributeError(name)\n'
  },
  {
    path: "openviking/metrics/global_api.py",
    sha256: "8fac39e266b11dda1d85deb4e10f31112afd0bf506cd1be8b43eaadeb1e08575",
    replacements: [["from .exporters.otel import OTelMetricExporter\n", ""],
      ["        if exporters_config.otel.enabled:\n", "        if exporters_config.otel.enabled:\n            from .exporters.otel import OTelMetricExporter\n\n"]],
    suffix: ""
  }
] as const;

export type LazyImportExperiment = "otel" | "litellm";

export function patchLazyImportSource(experiment: LazyImportExperiment, path: string, source: string): string {
  if (experiment === "litellm") return patchPrivateRuntimeSource(path, source);
  const edit = otelEdits.find(item => item.path === path);
  if (!edit || createHash("sha256").update(source).digest("hex") !== edit.sha256) {
    throw new Error("Lazy import experiment requires the exact pinned upstream source.");
  }
  for (const [before, after] of edit.replacements) {
    if (source.split(before).length !== 2) throw new Error("Ambiguous lazy import edit.");
    source = source.replace(before, after);
  }
  return source + edit.suffix;
}

export async function applyLazyImportExperiment(experiment: LazyImportExperiment, runtimeRoot: string, fixtureRoot: string): Promise<void> {
  const root = await realpath(fixtureRoot);
  const runtime = await realpath(runtimeRoot);
  // Caller owns a fresh test fixture and already verified its copied signed tree.
  if (!runtime.startsWith(`${root}${sep}installation${sep}`)) {
    throw new Error("Lazy import experiment must stay in the fresh fixture installation.");
  }
  if (experiment === "litellm") { await applyPrivateRuntimePatch(runtime); return; }
  const edits = otelEdits;
  const pending = await Promise.all(edits.map(async edit => {
    const path = join(runtime, "lib/python3.12/site-packages", edit.path);
    if (await realpath(path) !== path) throw new Error("Unexpected lazy import source link.");
    return { path, content: patchLazyImportSource(experiment, edit.path, await readFile(path, "utf8")) };
  }));
  // Validate every patch before writing any disposable staging file.
  for (const file of pending) await writeFile(file.path, file.content);
}

export const lazyOtelImportContract = `
import sys
import openviking.metrics.global_api
assert "openviking.metrics.exporters.otel" not in sys.modules
from openviking.metrics.exporters import PrometheusExporter, OTelMetricExporter
from openviking.metrics.exporters.otel import OTelMetricExporter as DirectExporter
assert OTelMetricExporter is DirectExporter
assert PrometheusExporter.__name__ == "PrometheusExporter"
import openviking.metrics.exporters as exporters
try:
    exporters.missing_exporter
except AttributeError:
    pass
else:
    raise AssertionError("Unknown exporter must remain unavailable")
print("LAZY_OTEL_IMPORT_CONTRACT_PASS")
`;

export const lazyLitellmImportContract = `
import sys
import openviking.server.bootstrap
from openviking.models.vlm import VLMFactory, OpenAIVLM
from openviking.models.embedder import OpenAIDenseEmbedder
from openviking_cli.utils.config.embedding_config import EmbeddingConfig, EmbeddingModelConfig
config = {"provider": "openai", "model": "synthetic", "api_key": "synthetic-key", "api_base": "http://127.0.0.1:1/v1"}
assert isinstance(VLMFactory.create(config), OpenAIVLM)
embedding = EmbeddingModelConfig(provider="openai", model="synthetic", api_key="synthetic-key", api_base="http://127.0.0.1:1/v1", dimension=8)
assert isinstance(EmbeddingConfig()._create_embedder("openai", "dense", embedding), OpenAIDenseEmbedder)
assert "litellm" not in sys.modules
from openviking.models.vlm import LiteLLMVLMProvider
from openviking.models.vlm.backends.litellm_vlm import LiteLLMVLMProvider as DirectVLM
from openviking.models.embedder import LiteLLMDenseEmbedder
from openviking.models.embedder.litellm_embedders import LiteLLMDenseEmbedder as DirectEmbedder
assert LiteLLMVLMProvider is DirectVLM
assert LiteLLMDenseEmbedder is DirectEmbedder
assert isinstance(VLMFactory.create({**config, "provider": "litellm", "model": "openai/synthetic"}), DirectVLM)
assert isinstance(EmbeddingConfig()._create_embedder("litellm", "dense", embedding), DirectEmbedder)
import openviking.models.vlm as vlm
import openviking.models.embedder as embedder
for module in (vlm, embedder):
    try:
        module.missing_provider
    except AttributeError:
        pass
    else:
        raise AssertionError("Unknown provider export must remain unavailable")
print("LAZY_LITELLM_IMPORT_CONTRACT_PASS")
`;
