import { stat } from "node:fs/promises";
import { join, relative } from "node:path";

const MAX_CAPTURED_RESOURCES = 512;
const MAX_REPORTED_RESOURCES = 128;
const STAGES = ["runtimeInitialization", "sessionRestore"];
const DEFERRED_OVERLAY_ASSET = /\/assets\/(?:ApprovalDialog|CommandPalette|CredentialDialog|DoctorDialog|ExtensionDialog|Modal-|UpdateDialog)/u;
const DEFERRED_WORKSPACE_ASSET = /\/assets\/(?:WorkspaceShell|code-highlighter|MapleMono|markdown-)/u;

export async function createRendererResourceCollector(page, assetRoot) {
  const welcome = await attachAssetFileBytes(await captureWelcomeDocumentAssets(page), assetRoot);
  const resources = new Map(STAGES.map((stage) => [stage, []]));
  const pending = new Set();
  let currentStage;
  let overflowStage;

  const onRequest = (request) => {
    if (!currentStage) return;
    const url = new URL(request.url());
    if (url.protocol !== "app:" || url.host !== "pi67") return;
    const stageResources = resources.get(currentStage);
    if (stageResources.length >= MAX_CAPTURED_RESOURCES) {
      overflowStage = currentStage;
      return;
    }
    const resource = {
      name: url.pathname,
      initiatorType: request.resourceType(),
      decodedBodyBytes: 0,
      transferBytes: 0,
      assetFileBytes: 0,
      durationMs: 0
    };
    stageResources.push(resource);
    const startedAt = performance.now();
    const sizeTask = Promise.all([
      request.sizes().catch(() => undefined),
      resolveAssetFileBytes(assetRoot, url.pathname)
    ])
      .then(([sizes, assetFileBytes]) => {
        resource.decodedBodyBytes = sizes?.responseBodySize ?? 0;
        resource.transferBytes = sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0;
        resource.assetFileBytes = assetFileBytes;
        resource.durationMs = performance.now() - startedAt;
      })
      .catch(() => undefined)
      .finally(() => pending.delete(sizeTask));
    pending.add(sizeTask);
  };

  page.on("request", onRequest);
  return {
    welcome,
    async measureStage(stage, operation) {
      if (!STAGES.includes(stage)) throw new Error(`Unknown renderer resource stage: ${stage}.`);
      if (currentStage) throw new Error(`Renderer resource stage ${currentStage} is already active.`);
      currentStage = stage;
      try {
        const result = await operation();
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        await Promise.all(pending);
        if (overflowStage === stage) {
          throw new Error(`Renderer resource stage ${stage} exceeds ${MAX_CAPTURED_RESOURCES} entries.`);
        }
        return { result, resources: deduplicateResources(resources.get(stage)) };
      } finally {
        currentStage = undefined;
      }
    },
    dispose() {
      page.off("request", onRequest);
    }
  };
}

export function summarizeRendererResourceTransitions(transitions) {
  if (!Array.isArray(transitions) || transitions.length === 0) {
    throw new Error("Renderer resource attribution requires at least one transition.");
  }
  return {
    schemaVersion: 1,
    sampleCount: transitions.length,
    capture: "Welcome document script/link assets plus stage-scoped Playwright app://pi67 requests",
    stages: {
      welcome: summarizeStage(transitions.map((transition) => transition.welcome)),
      runtimeInitialization: summarizeStage(transitions.map((transition) => transition.runtimeInitialization)),
      sessionRestore: summarizeStage(transitions.map((transition) => transition.sessionRestore))
    },
    limitations: [
      "Welcome captures document script and link assets after DOMContentLoaded, not every Chromium-internal resource.",
      "Stage attribution includes only app://pi67 requests initiated while the measured operation is active.",
      "Request sizes can be zero for cached or custom-scheme resources; request names remain authoritative.",
      "Asset file bytes come from the production renderer build input and do not represent transfer, parse, or decoded-memory cost.",
      "Worker-internal fetches and decoded runtime allocations are not represented."
    ]
  };
}

export function assertRendererResourceBoundaries(transition) {
  const welcomeViolations = transition.welcome
    .map((resource) => resource.name)
    .filter((name) => DEFERRED_WORKSPACE_ASSET.test(name) || DEFERRED_OVERLAY_ASSET.test(name));
  const runtimeViolations = transition.runtimeInitialization
    .map((resource) => resource.name)
    .filter((name) => DEFERRED_OVERLAY_ASSET.test(name));
  if (welcomeViolations.length > 0 || runtimeViolations.length > 0) {
    throw new Error(
      `Renderer resource boundary violation: welcome=${welcomeViolations.join(",") || "none"}; `
      + `runtimeInitialization=${runtimeViolations.join(",") || "none"}.`
    );
  }
}

export function rendererStageAssetMiBSamples(transitions, stage) {
  if (!["welcome", ...STAGES].includes(stage)) throw new Error(`Unknown renderer resource stage: ${stage}.`);
  return transitions.map((transition) => (
    transition[stage].reduce((total, resource) => total + resource.assetFileBytes, 0) / 1024 / 1024
  ));
}

export function printRendererResourceAttribution(attribution) {
  console.log("renderer resource attribution:");
  for (const [stage, summary] of Object.entries(attribution.stages)) {
    const names = summary.resources.map((resource) => resource.name).join(", ") || "none";
    console.log(
      `- ${stage}: p95=${summary.resourceCount.p95} resources, `
      + `${summary.assetFileMiB.p95}MiB assets, ${summary.decodedBodyMiB.p95}MiB body, additions=${names}`
    );
  }
}

async function captureWelcomeDocumentAssets(page) {
  return page.evaluate((limit) => {
    const assets = [...document.querySelectorAll("script[src], link[href]")].flatMap((element) => {
      const rawUrl = element instanceof HTMLScriptElement ? element.src : element.href;
      const url = new URL(rawUrl);
      if (url.protocol !== "app:" || url.host !== "pi67") return [];
      return [{
        name: url.pathname,
        initiatorType: element instanceof HTMLScriptElement ? "script" : "link",
        decodedBodyBytes: 0,
        transferBytes: 0,
        assetFileBytes: 0,
        durationMs: 0
      }];
    });
    if (assets.length > limit) throw new Error(`Welcome asset snapshot exceeds ${limit} entries.`);
    return assets;
  }, MAX_CAPTURED_RESOURCES).then(deduplicateResources);
}

function deduplicateResources(input) {
  const byName = new Map();
  for (const resource of input) {
    const current = byName.get(resource.name);
    if (!current || resource.assetFileBytes > current.assetFileBytes || resource.decodedBodyBytes > current.decodedBodyBytes) {
      byName.set(resource.name, resource);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function summarizeStage(samples) {
  const resources = new Map();
  for (const sample of samples) {
    for (const resource of sample) {
      const current = resources.get(resource.name) ?? {
        name: resource.name,
        sampleCount: 0,
        initiatorTypes: new Set(),
        maxDecodedBodyBytes: 0,
        maxTransferBytes: 0,
        maxAssetFileBytes: 0,
        maxDurationMs: 0
      };
      current.sampleCount += 1;
      current.initiatorTypes.add(resource.initiatorType);
      current.maxDecodedBodyBytes = Math.max(current.maxDecodedBodyBytes, resource.decodedBodyBytes);
      current.maxTransferBytes = Math.max(current.maxTransferBytes, resource.transferBytes);
      current.maxAssetFileBytes = Math.max(current.maxAssetFileBytes, resource.assetFileBytes);
      current.maxDurationMs = Math.max(current.maxDurationMs, resource.durationMs);
      resources.set(resource.name, current);
    }
  }
  const reported = [...resources.values()]
    .sort((left, right) => (
      right.sampleCount - left.sampleCount
      || right.maxDecodedBodyBytes - left.maxDecodedBodyBytes
      || left.name.localeCompare(right.name)
    ))
    .slice(0, MAX_REPORTED_RESOURCES)
    .map((resource) => ({
      name: resource.name,
      sampleCount: resource.sampleCount,
      sampleRate: round(resource.sampleCount / samples.length),
      initiatorTypes: [...resource.initiatorTypes].sort((left, right) => left.localeCompare(right)),
      maxDecodedBodyBytes: resource.maxDecodedBodyBytes,
      maxTransferBytes: resource.maxTransferBytes,
      maxAssetFileBytes: resource.maxAssetFileBytes,
      maxDurationMs: round(resource.maxDurationMs)
    }));
  return {
    resourceCount: summarizeNumbers(samples.map((sample) => sample.length)),
    decodedBodyMiB: summarizeNumbers(samples.map((sample) => (
      sample.reduce((total, resource) => total + resource.decodedBodyBytes, 0) / 1024 / 1024
    ))),
    assetFileMiB: summarizeNumbers(samples.map((sample) => (
      sample.reduce((total, resource) => total + resource.assetFileBytes, 0) / 1024 / 1024
    ))),
    resources: reported,
    truncatedResourceCount: Math.max(0, resources.size - reported.length)
  };
}

async function attachAssetFileBytes(resources, assetRoot) {
  return Promise.all(resources.map(async (resource) => ({
    ...resource,
    assetFileBytes: await resolveAssetFileBytes(assetRoot, resource.name)
  })));
}

async function resolveAssetFileBytes(assetRoot, pathname) {
  if (!assetRoot || typeof pathname !== "string") return 0;
  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath || relativePath.split("/").includes("..")) return 0;
  const path = join(assetRoot, relativePath);
  const scopedPath = relative(assetRoot, path);
  if (!scopedPath || scopedPath.startsWith("..")) return 0;
  try {
    const metadata = await stat(path);
    return metadata.isFile() ? metadata.size : 0;
  } catch {
    return 0;
  }
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95))
  };
}

function percentile(sorted, fraction) {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
