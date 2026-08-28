import { measureSessionOpenPerformanceSample } from "../../packages/pi-runtime/eng/session-open-performance-fixture.mjs";

const raw = process.argv[2];
if (!raw) throw new Error("Session-open child input is required.");
const input = JSON.parse(raw);
const result = await measureSessionOpenPerformanceSample(input);
process.stdout.write(`${JSON.stringify(result)}\n`);
