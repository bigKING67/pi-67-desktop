import { installOpenVikingRuntime } from "../../artifacts/memory-installer/openviking-runtime-installer.mjs";

// Explicit operator command: source installation + existing owner-controlled runtime parent.
// Trust stays source-pinned. Never supplies test keys, credentials or automatic activation.
const abort = new AbortController();
const cancel = () => abort.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const [source, parent, purposeFlag, ...extra] = process.argv.slice(2);
  if (!source || !parent || extra.length || purposeFlag !== undefined && !["--team-index-v1", "--team-query-v1"].includes(purposeFlag)) {
    throw new Error("Expected source, runtime parent and optional --team-index-v1 or --team-query-v1.");
  }
  console.log(JSON.stringify(await installOpenVikingRuntime({ source, parent, signal: abort.signal,
    purpose: purposeFlag === undefined ? "private" : purposeFlag.slice(2) }), null, 2));
} catch {
  console.error("Runtime installation failed or was cancelled; existing versions are retained and no service was activated.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
