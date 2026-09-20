/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startNativeTeamModelWorker } from "../../apps/desktop/src/native-team-model-worker.mjs";
import { attachNativeTeamModelChannel } from "../../apps/agent-host/src/context/native-team-model-channel.js";

// Differential diagnostic, not online authorization, runtime admission or IPC
// certification. Only controlled authorization latency differs between samples.
const [python, bootstraps] = process.argv.slice(2);
assert.ok(python && bootstraps && isAbsolute(python) && isAbsolute(bootstraps));
for (const latency of [0, 2500]) {
  const temporary = await mkdtemp(join(tmpdir(), "newmoney-index-deadline-"));
  let confirmed = true;
  try {
    const scopeKey = "a".repeat(64), staging = join(temporary, scopeKey, "staging");
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(staging, "run-"));
    const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "experience", "Live Desktop fixture", "Synthetic summary", "Synthetic live body"]);
    const model = { endpoint: "https://model.invalid/v1", model: "fixture" };
    await writeFile(join(directory, "job.json"), JSON.stringify({ schema: "newmoney.team-index-job.v1", scopeKey,
      embedding: { ...model, dimension: 8 }, extraction: model,
      documents: [{ assetId: randomUUID(), contentRevision: createHash("sha256").update(canonicalContent).digest("hex"), canonicalContent }] }), { mode: 0o600 });
    const signal = AbortSignal.timeout(90_000);
    let authorizations = 0, invokes = 0;
    const authorize = async () => {
      await delay(latency, undefined, { signal }); authorizations++;
      return { deadline: Date.now() + 60_000, assertModel: () => signal.throwIfAborted() };
    };
    const started = performance.now(); confirmed = false;
    const worker = await startNativeTeamModelWorker({ python, cwd: directory,
      bootstrap: join(bootstraps, "team_index_deadline_probe.py"), arguments: [join(bootstraps, "team_index_worker.py")],
      attachModelChannel: channel => attachNativeTeamModelChannel(channel, {
        scope: { userId: "synthetic", teamId: "synthetic", projectId: null },
        models: { embedding: { baseUrl: model.endpoint, id: model.model }, extraction: { baseUrl: model.endpoint, id: model.model } },
        gateway: { authorizeTeam: authorize, authorizeProject: authorize } as never, signal,
        async invoke(_purpose, _selected, body) {
          invokes++; const request = JSON.parse(Buffer.from(body).toString()) as { input: string | string[] };
          const inputs = Array.isArray(request.input) ? request.input : [request.input];
          return { status: 200, body: Buffer.from(JSON.stringify({ model: model.model,
            data: inputs.map((_, index) => ({ index, embedding: [0.25, 0.75, 0, 0, 0, 0, 0, 0] })) })) };
        }
      }) }, signal);
    const result = await worker.completion;
    assert.throws(() => process.kill(-worker.pid, 0), { code: "ESRCH" }); confirmed = true;
    let observation: unknown;
    try { observation = JSON.parse(await readFile(join(directory, "deadline-diagnostic.json"), "utf8")) as unknown; }
    catch { observation = { missing: true }; }
    assert.ok(observation && typeof observation === "object" && Object.values(observation).every(value => typeof value === "boolean"));
    console.log("INDEX_DEADLINE_DIAGNOSTIC", { latency, code: result.code, authorizations, invokes, elapsedMs: Math.round(performance.now() - started), observation });
    assert.equal(result.code, 0);
    assert.ok("vectorComplete" in observation && observation.vectorComplete === true
      && "contentUpdated" in observation && observation.contentUpdated === true);
    assert.ok(invokes > 0 && authorizations === invokes);
    if (latency > 0) assert.ok(invokes * latency > 30_000, "Slow sample must exceed the retired queue cutoff");
  } finally {
    if (confirmed) await rm(temporary, { recursive: true, force: true });
    else console.error(`Native cleanup unconfirmed; isolated diagnostic retained at ${temporary}`);
  }
}
