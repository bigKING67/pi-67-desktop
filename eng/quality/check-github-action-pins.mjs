import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function mutableActionReferences(source, path = "workflow.yml") {
  const failures = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const match = /^\s*(?:-\s+)?uses\s*:\s*([^\s#]+)/u.exec(line);
    if (!match) continue;
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    if (!/^[^@\s]+@[0-9a-f]{40}$/u.test(reference)) {
      failures.push(`${path}:${index + 1} must pin an external action to a full lowercase commit SHA: ${reference}`);
    }
  }
  return failures;
}

async function main() {
  const workflowDirectory = join(root, ".github/workflows");
  const names = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  const failures = [];
  let references = 0;
  for (const name of names) {
    const path = `.github/workflows/${name}`;
    const source = await readFile(join(workflowDirectory, name), "utf8");
    references += source.split(/\r?\n/u).filter((line) => /^\s*(?:-\s+)?uses\s*:/u.test(line)).length;
    failures.push(...mutableActionReferences(source, path));
  }
  if (failures.length > 0) {
    console.error(`GitHub Action pin check failed with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`GitHub Action pin check passed: ${references} references across ${names.length} workflows.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
