import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
if (!/^export const PROTOCOL_REVISION = "[0-9a-f]{64}" as const;\n$/u.test(previous)) {
  throw new Error("Refusing to replace an unexpected protocol-revision.ts shape.");
}
await writeFile(
  revisionFile,
  `export const PROTOCOL_REVISION = "${revision}" as const;\n`,
  "utf8"
);
process.stdout.write(`${revision}\n`);
