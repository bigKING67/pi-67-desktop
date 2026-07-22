import {
  inspectVersionProjections,
  loadVersionContract,
  syncVersionProjections,
} from "./version-contract.mjs";

const version = await loadVersionContract();
const changed = await syncVersionProjections(version);
const issues = await inspectVersionProjections(version);
if (issues.length > 0) throw new Error(issues.join("\n"));

if (changed.length === 0) process.stdout.write("Version projections were already synchronized.\n");
else process.stdout.write(`Synchronized ${changed.length} version projections:\n${changed.join("\n")}\n`);
