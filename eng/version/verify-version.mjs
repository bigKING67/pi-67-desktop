import { inspectVersionProjections, loadVersionContract } from "./version-contract.mjs";

const version = await loadVersionContract();
const issues = await inspectVersionProjections(version);
if (issues.length > 0) {
  process.stderr.write(`Version projection verification failed:\n- ${issues.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Version projections match ${version.semver} (${version.msiVersion}).\n`);
}
