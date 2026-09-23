import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileOwnedExtension } from "./compile-owned-extension.mjs";
import { assertPreparedLocalModuleClosure } from "./prepared-module-closure.mjs";
import { copyAllowedCapabilityEntries as copyAllowed,
  writeCapabilityPackageManifest as writePackageManifest } from "./prepared-capability-files.mjs";

export async function prepareOpenVikingPiExtension(
  sourceRoot, source, destination
) {
  await copyAllowed(sourceRoot, destination, [
    "UPSTREAM.md",
    "archive-tool-support.ts",
    "client.ts",
    "client-contracts.ts",
    "config.json",
    "config.ts",
    "desktop-commit-outcome.ts",
    "desktop-memory-commit.ts",
    "diagnostics.ts",
    "index.ts",
    "lib",
    "managed-connection.ts",
    "managed-extension.ts",
    "memory-owner-policy.ts",
    "package.json",
    "private-uri-policy.ts",
    "recall.ts",
    "recall-timing.ts",
    "recall-feedback.ts",
    "recall-tool-policy.ts",
    "recall-tool-support.ts",
    "runtime-privacy.ts",
    "scoped-pending-queue.ts",
    "shared",
    "sync.ts",
    "takeover.ts",
    "tool-result.ts",
    "tools.ts"
  ]);
  await assertPreparedLocalModuleClosure(destination, "index.ts");
  await assertPreparedLocalModuleClosure(destination, "managed-extension.ts");
  const packageManifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  if (packageManifest.version !== source.version || packageManifest.pi?.extensions?.[0] !== "./index.ts") {
    throw new Error("Bundled OpenViking Pi Extension does not match its Desktop source lock.");
  }
  await compileOwnedExtension({ sourceRoot, entryPath: "index.ts", destination, bundleTypebox: true });
  packageManifest.pi.extensions = ["./index.js"];
  delete packageManifest.dependencies.typebox;
  await writePackageManifest(destination, packageManifest);
}
