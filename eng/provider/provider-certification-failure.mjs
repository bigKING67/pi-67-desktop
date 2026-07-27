import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeProviderCertificationFailureAndThrow(outputPath, failureSummary) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(failureSummary, null, 2)}\n`, "utf8");
  throw new Error(
    `Real Provider long-turn certification failed during ${failureSummary.error.stage}; inspect the bounded receipt artifact.`
  );
}
