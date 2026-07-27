import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SESSION_PROJECTION_SIZES,
  createSessionProjectionFixture,
  measureSessionProjection
} from "../../packages/pi-runtime/eng/session-projection-performance-fixture.mjs";
import { resolveSampleCount } from "./performance-contract.mjs";
import { writeSessionProjectionPerformanceReport } from "./session-projection-performance-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sampleCount = resolveSampleCount();
const outputPath = process.env.PI67_PERF_SESSION_PROJECTION_OUTPUT
  ?? join(root, "artifacts/performance", `session-projection-${process.platform}-${process.arch}.json`);
const small = createSessionProjectionFixture(SESSION_PROJECTION_SIZES.small);
const large = createSessionProjectionFixture(SESSION_PROJECTION_SIZES.large);
const samples = {
  bind1k: [],
  bind10k: [],
  entryScans10k: [],
  bootstrap1k: [],
  bootstrap10k: [],
  olderPage10k: [],
  recentPageBytes10k: []
};

for (let index = 0; index < sampleCount; index += 1) {
  const smallSample = measureSessionProjection(small);
  samples.bind1k.push(smallSample.bindMs);
  samples.bootstrap1k.push(smallSample.bootstrapMs);

  const largeSample = measureSessionProjection(large);
  samples.bind10k.push(largeSample.bindMs);
  samples.entryScans10k.push(largeSample.entryScans);
  samples.bootstrap10k.push(largeSample.bootstrapMs);
  samples.olderPage10k.push(largeSample.olderPageMs);
  samples.recentPageBytes10k.push(largeSample.recentPageBytes);
}

await writeSessionProjectionPerformanceReport({ root, outputPath, samples });
