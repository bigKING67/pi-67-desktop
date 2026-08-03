import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseProtocolRevisionSource } from "./protocol-revision-source.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtEntry = resolve(packageRoot, "dist/index.mjs");
const revisionFile = resolve(packageRoot, "src/protocol-revision.ts");
const protocol = await import(`${pathToFileURL(builtEntry).href}?revision=${Date.now()}`);
if (typeof protocol.canonicalProtocolRevisionMaterial !== "function") {
  throw new Error("Build @pi67/protocol before generating its protocol revision.");
}

const revision = createHash("sha256")
  .update(protocol.canonicalProtocolRevisionMaterial(), "utf8")
  .digest("hex");
const previous = await readFile(revisionFile, "utf8");
const previousRevision = parseProtocolRevisionSource(previous);
if (process.argv.includes("--check")) {
  if (previousRevision !== revision) {
    throw new Error(
      `Protocol revision is stale: expected ${revision}, received ${previousRevision}. `
      + "Run `corepack pnpm --filter @pi67/protocol run generate:revision` and commit the schema and revision together."
    );
  }
  process.stdout.write(`${revision}\n`);
  process.exit(0);
}
await writeFile(
  revisionFile,
  `export const PROTOCOL_REVISION = "${revision}" as const;\n`,
  "utf8"
);
process.stdout.write(`${revision}\n`);
