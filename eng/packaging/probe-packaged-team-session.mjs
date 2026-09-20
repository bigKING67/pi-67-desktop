import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "@playwright/test";
import { startLiveKnowledgeFixture } from "../capabilities/shared-knowledge-live-fixture.ts";
import { createPackagedTestDirectories, launchPackagedApplication, cleanupPackagedTestDirectories,
  repositoryRoot, resolvePackagedArtifact } from "./packaged-electron-fixture.mjs";
import { openSettingsSection, openPackagedSmokeWorkspace, ensurePackagedNewSessionIntent } from "./packaged-electron-smoke-scenarios.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";
import { startPrivateMemoryModel } from "./packaged-private-memory-model.mjs";
import { packagedTeamQueryStages, writePackagedTeamSessionReceipt } from "./packaged-team-session-receipt.mjs";
import { createTeamPhaseCapture } from "./packaged-team-phase-diagnostics.mjs";

// Explicit live acceptance only. Product Main, Renderer, Host and Pi are not replaced.
const directory = process.env.PI67_NEWMONEY_LIVE_DIRECTORY;
const native = process.argv.includes("--native");
assert.ok(process.argv.slice(2).every(arg => arg === "--native"));
assert.ok(process.platform === "darwin" && process.arch === "arm64" && directory && isAbsolute(directory),
  "Requires macOS arm64 and an explicit private live directory");
assert.equal(process.env.NODE_EXTRA_CA_CERTS, join(directory, "cert.pem"));
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
const artifact = resolvePackagedArtifact();
const asarSha256 = createHash("sha256").update(await readFile(join(artifact.resourcesPath, "app.asar"))).digest("hex");
const profile = await createPackagedTestDirectories("new-money-packaged-team-");
const model = await startPrivateMemoryModel({ teamNative: native, ...(native ? { tls: {
  key: await readFile(join(directory, "key.pem")), cert: await readFile(join(directory, "cert.pem"))
} } : {}) });
let application, window, fixture, stage = "prepare", stageStarted = performance.now(), passed = false, closed = true;
let failureKind, queryStages = [], queryObserved = false, queryEmbeddingStart, queryAfterRequestSequence;
const phaseCaptures = [];
const environment = { PI_AGENT_DIR: profile.agentDir, PI67_MEMORY_PRIVACY_MODE: "read-only",
  PI67_DEBUG_AGENT_STDERR: "1",
  OPENVIKING_CREDENTIAL_SOURCE: "env", OPENVIKING_CLI_CONFIG_FILE: join(profile.userDataDirectory, "absent-cli.json"),
  OPENVIKING_CONFIG_FILE: join(profile.userDataDirectory, "absent-ov.json"), OPENVIKING_PENDING_DIR: join(profile.userDataDirectory, "pending") };
for (const key of Object.keys(process.env)) {
  if ((key.startsWith("OPENVIKING_") || key.startsWith("OV_") || key.startsWith("NEWMONEY_TEST_")) && !(key in environment)) environment[key] = "";
}
const launch = async () => {
  application = await launchPackagedApplication({ ...profile, artifact, environment, isolateNativeWindow: true });
  const capture = createTeamPhaseCapture(); phaseCaptures.push(capture);
  application.process().stdout?.on("data", chunk => capture.write("stdout", chunk));
  application.process().stderr?.on("data", chunk => capture.write("stderr", chunk));
  closed = false;
  return application.firstWindow();
};
const close = async () => {
  if (!application) return;
  const result = await closeElectronApplicationWithinTimeout({ application });
  assert.ok(!result.timedOut && !result.error && !result.mainAliveAfterClose, "Packaged process exit unconfirmed");
  application = undefined; closed = true;
};
const phase = value => { stage = value; stageStarted = performance.now(); console.info(`Packaged team session: ${stage}`); };
async function memorySettings(window) {
  await window.getByRole("list", { name: "工作区与对话" }).waitFor({ state: "visible", timeout: 60_000 });
  const settings = await openSettingsSection(window, /上下文与记忆/u);
  await settings.getByRole("tab", { name: "团队经验", exact: true }).click();
  return settings;
}
async function chooseScope(window, project = true) {
  await window.getByRole("button", { name: /New Money 团队/u }).click();
  await window.getByRole("option", { name: /Macro Research/u }).click();
  if (project) {
    await window.getByRole("button", { name: /New Money 项目/u }).click();
    await window.getByRole("option", { name: /Live Desktop fixture/u }).click();
  }
}
async function sessions() {
  const root = join(profile.agentDir, "sessions");
  if (!existsSync(root)) return [];
  return Promise.all((await readdir(root, { recursive: true })).filter(path => path.endsWith(".jsonl")).map(async relative => {
    const path = join(root, relative), bytes = await readFile(path);
    const entries = bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    return { path, bytes, entries, origin: entries.find(entry => entry.type === "custom" && entry.customType === "pi67.memory-provenance.v1")?.data };
  }));
}
async function send(window, text) {
  await window.getByRole("textbox", { name: "给 Pi 发送消息" }).fill(text);
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await expect(window.locator('[data-runtime-phase="ready"]')).toBeVisible({ timeout: 90_000 });
}
try {
  await Promise.all([
    writeFile(join(profile.agentDir, "settings.json"), JSON.stringify({ defaultProvider: "memory-fixture", defaultModel: "agent", compaction: { enabled: false }, retry: { enabled: false } }), { mode: 0o600 }),
    writeFile(join(profile.agentDir, "models.json"), JSON.stringify({ providers: { "memory-fixture": { baseUrl: model.endpoint, api: "openai-completions", models: [{ id: "agent", name: "agent", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 1024 }] } } }), { mode: 0o600 }),
    writeFile(join(profile.agentDir, "auth.json"), JSON.stringify({ "memory-fixture": { type: "api_key", key: "synthetic-memory-only" } }), { mode: 0o600 }),
    writeFile(join(profile.agentDir, "openviking.json"), JSON.stringify({ enabled: true, privacyMode: "read-only", enterpriseGatewayEndpoint: "", syncTurns: false, captureAssistantTurns: false, takeover: { enabled: false }, logLevel: "silent" }), { mode: 0o600 })
  ]);
  phase("private-session");
  window = await launch();
  await openPackagedSmokeWorkspace({ application, window, workspace: profile.workspace });
  await ensurePackagedNewSessionIntent(window, 60_000);
  await send(window, "NM-PACKAGED-TEAM-PRIVATE: isolated private history.");
  let privateSession;
  await expect.poll(async () => { privateSession = (await sessions()).find(item => item.origin?.kind === "private"); return !!privateSession; }, { timeout: 30_000 }).toBe(true);
  await close();
  privateSession.bytes = await readFile(privateSession.path);
  window = await launch();
  if (native) {
    phase("install-team-runtimes-and-models");
    const settings = await memorySettings(window);
    await settings.getByRole("tab", { name: "记忆与隐私", exact: true }).click();
    const form = settings.getByTestId("context-memory-settings");
    for (const [purpose, label, source] of [
      ["team-index-v1", "团队索引运行包", process.env.PI67_TEAM_INDEX_TEST_INSTALLATION],
      ["team-query-v1", "团队检索运行包", process.env.PI67_TEAM_QUERY_TEST_INSTALLATION]
    ]) {
      assert.ok(source && isAbsolute(source), "Explicit signed team runtime source required");
      await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
      await form.getByRole("button", { name: `安装${label}`, exact: true }).click();
      await expect.poll(() => window.evaluate(kind => window.pi67.system.localMemoryRuntime.getStatus(kind), purpose), { timeout: 180_000 }).toBe("present");
    }
    for (const [label, value] of [["提取 Provider ID", "memory-fixture"], ["提取模型 ID", "agent"],
      ["Embedding 服务地址", model.endpoint], ["Embedding 模型 ID", "embedding"], ["向量维度", "8"],
      ["Embedding API Key", "synthetic-memory-only"]]) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole("button", { name: "保存模型配置", exact: true }).click();
    await expect(form.getByText("模型配置已保存，下次服务启动时生效。本次保存没有改变启用设置，也未调用模型。", { exact: true })).toBeVisible();
    assert.equal(await window.evaluate(() => window.pi67.system.localMemoryRuntime.getStatus("private")), "missing");
    assert.equal((await window.evaluate(() => window.pi67.system.localMemoryActivation.get())).selectedAtLaunch, false);
    await settings.getByRole("button", { name: "返回工作台", exact: true }).click();
  }
  phase("wait-for-live-api");
  const waiting = AbortSignal.timeout(720_000);
  while (!existsSync(join(directory, "connection.json"))) await delay(500, undefined, { signal: waiting });
  fixture = await startLiveKnowledgeFixture(directory);
  assert.ok(fixture.webGovernance, "Requires the explicit extended Web fixture window");
  phase("device-login");
  let settings = await memorySettings(window);
  await settings.getByRole("textbox", { name: "New Money 服务地址" }).fill(fixture.credential.endpoint);
  await settings.getByRole("button", { name: "保存更改", exact: true }).click();
  phase("device-begin");
  await settings.getByRole("button", { name: "连接 New Money", exact: true }).click();
  const code = settings.locator("code");
  await expect(code).toHaveCount(1);
  phase("device-approve");
  await fixture.approveDevice(await code.innerText());
  phase("device-overview");
  // The real UI loads identity, teams, projects and binding after exchange.
  // Cross-host DB fixtures amplify these serial reads; individual product limits stay unchanged.
  await expect(settings.getByRole("button", { name: "断开连接", exact: true })).toBeVisible({ timeout: 90_000 });
  phase("project-binding");
  await chooseScope(window);
  await settings.getByRole("button", { name: "绑定", exact: true }).click();
  // A successful binding may take the product's full 8-second request budget.
  await expect(settings.getByRole("button", { name: "同步当前项目", exact: true })).toBeEnabled({ timeout: 15_000 });
  phase("publication-and-product-sync");
  const base = `/v1/agent/teams/${fixture.scope.teamId}`;
  const published = await fixture.api(`${base}/candidates/${fixture.candidateId}/publish`, "POST");
  assert.equal(published.status, 201); await published.body?.cancel();
  phase("product-sync");
  await settings.getByRole("button", { name: "同步当前项目", exact: true }).click();
  const syncFailure = settings.getByText(/^同步未完成/u);
  await settings.getByText(/已接收当前项目内容/u).or(syncFailure).waitFor({ state: "visible", timeout: 75_000 });
  if (await syncFailure.isVisible()) {
    const notice = await syncFailure.innerText();
    const reasons = ["receipt service is unavailable", "superseded or cancelled", "synchronization is busy",
      "endpoint changed", "sign-in has expired", "Sign in to New Money first", "INVALID_PAYLOAD", "REQUEST_TIMEOUT",
      "Command does not support App authority", "Command requires Workspace or Task authority", "Shared sync open failed", "Shared sync append failed",
      "Shared sync close failed", "aborted", "fetch failed", "not allowed", "Unsupported", "Invalid"];
    console.error(`PACKAGED_SYNC_DIAGNOSTIC: ${reasons.filter(reason => notice.includes(reason)).join(",") || "unclassified"}`);
    throw new Error("Product sync failed");
  }
  await expect(settings.getByText(/已接收当前项目内容/u)).toBeVisible({ timeout: 60_000 });
  const policyResponse = await fixture.api(`${base}/model-policy`);
  assert.equal(policyResponse.status, 200); const policy = await policyResponse.json();
  const updated = await fixture.api(`${base}/model-policy`, "PUT", { expectedRevision: policy.revision,
    allowedModels: [{ purpose: "agent", endpoint: model.endpoint, modelId: "agent" }, ...(native ? [
      { purpose: "embedding", endpoint: model.endpoint, modelId: "embedding" },
      { purpose: "extraction", endpoint: model.endpoint, modelId: "agent" }
    ] : [])] });
  assert.equal(updated.status, 200); await updated.body?.cancel();
  if (native) {
    phase("native-project-index");
    await settings.getByRole("button", { name: "构建当前项目索引", exact: true }).click();
    await settings.getByText(/本次项目索引已构建|构建未确认完成/u).waitFor({ state: "visible", timeout: 300_000 });
    const failure = settings.getByText(/构建未确认完成/u);
    if (await failure.isVisible()) {
      const notice = await failure.innerText();
      const reasons = ["Team index settings unavailable", "Team index model configuration unavailable",
        "Team indexing unavailable", "Shared sync", "索引构建结果尚未确认", "timed out", "aborted"];
      console.error(`PACKAGED_INDEX_DIAGNOSTIC: ${reasons.filter(reason => notice.includes(reason)).join(",") || "unclassified"}`);
    }
    await expect(settings.getByText(/本次项目索引已构建/u)).toBeVisible();
    assert.ok(model.counts.embedding > 0);
  }
  await settings.getByRole("button", { name: "返回工作台", exact: true }).click();
  phase("team-session");
  await ensurePackagedNewSessionIntent(window, 60_000);
  await window.getByRole("button", { name: "选择团队与项目", exact: true }).click();
  await chooseScope(window);
  await window.getByRole("button", { name: "另开团队草稿", exact: true }).click();
  const beforeTeamCalls = model.counts.agent;
  const beforeTeamEmbedding = model.counts.embedding;
  const beforeTeamRequests = fixture.diagnostics().requests;
  queryEmbeddingStart = beforeTeamEmbedding; queryAfterRequestSequence = beforeTeamRequests;
  await send(window, native ? "NM-PACKAGED-TEAM-NATIVE: search and read the authorized project knowledge."
    : "NM-PACKAGED-TEAM: authorized team session.");
  await expect.poll(() => model.counts.agent, { timeout: 60_000 }).toBeGreaterThan(beforeTeamCalls);
  let teamSession;
  await expect.poll(async () => { teamSession = (await sessions()).find(item => item.origin?.kind === "team"); return !!teamSession; }, { timeout: 30_000 }).toBe(true);
  if (native) {
    queryStages = packagedTeamQueryStages(teamSession.entries); queryObserved = true;
    console.info("PACKAGED_TEAM_QUERY_TRANSPORT", { embeddingRequests: model.counts.embedding - beforeTeamEmbedding,
      timeline: fixture.diagnostics().timeline.filter(event => event.sequence > beforeTeamRequests) });
    const failed = teamSession.entries.some(entry => entry.type === "message"
      && (entry.message.role === "toolResult" && entry.message.isError || entry.message.role === "assistant" && entry.message.stopReason === "error"));
    if (failed) {
      console.error("PACKAGED_TEAM_QUERY_STAGES", queryStages);
    }
    assert.equal(failed, false, "Actual team Tool/model run failed; do not wait for a success marker");
    await expect(window.getByTestId("virtuoso-scroller").getByText("NM-PACKAGED-TEAM-NATIVE-PASS", { exact: true })).toBeVisible({ timeout: 30_000 });
  }
  assert.deepEqual(teamSession.origin, { version: 1, kind: "team", originSessionId: teamSession.entries[0].id,
    userId: fixture.credential.userId, endpoint: fixture.credential.endpoint, teamId: fixture.scope.teamId, projectId: fixture.scope.scopeId });
  await expect(window.getByLabel("会话来源", { exact: true })).toContainText(fixture.scope.scopeId);
  assert.ok(privateSession.bytes.equals(await readFile(privateSession.path)), "Private history changed");
  assert.ok(model.counts.agent > 0 && (native ? model.counts.embedding > 0 : model.counts.embedding === 0)
    && model.counts.extraction === 0 && model.counts.rejected === 0);
  if (native) {
    assert.deepEqual(model.teamEvidence, { searchRequests: 1, readRequests: 1, exactBody: true });
    const results = teamSession.entries.filter(entry => entry.type === "message" && entry.message.role === "toolResult");
    assert.equal(results.length, 2);
    assert.deepEqual(results.map(entry => [entry.message.toolName, entry.message.isError]), [["viking_team_search", false], ["viking_team_read", false]]);
    assert.equal(results[0].message.details.items[0].assetId, fixture.candidateId);
    assert.equal(results[1].message.details.reference.assetId, fixture.candidateId);
    assert.equal(results[1].message.details.document.body, "Synthetic live body");
  }
  await close();
  phase("cold-recovery"); window = await launch();
  const origin = window.getByLabel("会话来源", { exact: true });
  const resume = window.getByRole("button", { name: "恢复任务", exact: true });
  const open = window.getByRole("button", { name: "打开对话", exact: true });
  await origin.or(resume).or(open).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await resume.isVisible()) await resume.click();
  else if (await open.isVisible()) await open.click();
  await expect(origin).toContainText(fixture.scope.scopeId, { timeout: 60_000 });
  settings = await memorySettings(window);
  await expect(settings.getByRole("button", { name: "断开连接", exact: true })).toBeVisible({ timeout: 30_000 });
  assert.ok((await sessions()).some(item => item.path === teamSession.path && JSON.stringify(item.origin) === JSON.stringify(teamSession.origin)));
  phase("revocation-and-denial");
  const detail = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`);
  assert.equal(detail.status, 200); const etag = detail.headers.get("etag"); assert.ok(etag); await detail.body?.cancel();
  const revoked = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`, "DELETE", undefined, { "If-Match": etag });
  assert.equal(revoked.status, 204); await revoked.body?.cancel();
  if (native) {
    phase("revoked-native-history-denial");
    const before = { ...model.counts };
    await settings.getByRole("button", { name: "返回工作台", exact: true }).click();
    await send(window, "NM-PACKAGED-TEAM-REVOKED: do not process revoked shared history.");
    await expect.poll(async () => {
      const current = (await sessions()).find(item => item.path === teamSession.path);
      return current?.entries.some(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason === "error");
    }, { timeout: 90_000 }).toBe(true);
    assert.deepEqual(model.counts, before, "Revoked history reached a model");
    settings = await memorySettings(window);
  }
  const removed = await fixture.api(`${base}/projects/${fixture.scope.scopeId}/members/${fixture.credential.userId}`, "DELETE");
  assert.equal(removed.status, 204); await removed.body?.cancel();
  await settings.getByRole("button", { name: "同步当前项目", exact: true }).click();
  await expect(settings.getByText(/同步未完成/u)).toBeVisible({ timeout: 60_000 });
  assert.ok(privateSession.bytes.equals(await readFile(privateSession.path)), "Private history changed after revocation");
  await settings.getByRole("button", { name: "断开连接", exact: true }).click();
  await expect(settings.getByRole("button", { name: "连接 New Money", exact: true })).toBeVisible();
  assert.equal(fixture.diagnostics().sessionRevocations, 1);
  await close();
  phase("cold-signed-out"); window = await launch(); settings = await memorySettings(window);
  await expect(settings.getByRole("button", { name: "连接 New Money", exact: true })).toBeVisible({ timeout: 30_000 });
  await close();
  passed = true;
} catch (cause) {
  const knownControls = ["断开连接", "连接 New Money", "New Money 团队", "New Money 项目", "同步当前项目", "会话来源"];
  const control = knownControls.find(label => cause instanceof Error && cause.message.includes(label)) ?? "unknown";
  const kind = cause instanceof Error && ["Error", "TimeoutError", "AssertionError"].includes(cause.name) ? cause.name : "unknown";
  failureKind = kind;
  if (native && stage === "team-session") {
    try {
      const current = (await sessions()).find(item => item.origin?.kind === "team");
      if (current) { queryStages = packagedTeamQueryStages(current.entries); queryObserved = true; }
    } catch { queryObserved = false; /* Record unavailable evidence, never replace the original failure. */ }
  }
  const credentialPersisted = existsSync(join(profile.userDataDirectory, "runtime", "enterprise-context-credential-v1.json"));
  console.error(`PACKAGED_TEAM_DIAGNOSTIC: kind=${kind}; control=${control}; credentialPersisted=${credentialPersisted}; stageElapsedMs=${Math.round(performance.now() - stageStarted)}`);
  console.error("PACKAGED_MODEL_COUNTS", model.counts, model.teamEvidence);
  console.error(`PACKAGED_TEAM_SESSION_FAILED: stage=${stage}; no credentials, bodies or raw child output logged; profile=${profile.userDataDirectory}`);
  process.exitCode = 1;
} finally {
  const stageElapsedMs = Math.round(performance.now() - stageStarted);
  let cleanupCompleted = false, profileRemoved = false;
  try {
    try { await close(); } catch { passed = false; process.exitCode = 1; }
    await model.close();
    if (fixture) await fixture.close(passed);
    if (passed && closed) {
      await cleanupPackagedTestDirectories(profile.userDataDirectory);
      profileRemoved = !existsSync(profile.userDataDirectory); assert.ok(profileRemoved);
    }
    cleanupCompleted = true;
  } finally {
    const receiptPath = await writePackagedTeamSessionReceipt(join(repositoryRoot, "artifacts/evidence/packaged-team-session"), {
      asarSha256, native, passed, stage, stageElapsedMs, failureKind, queryStages, queryObserved, queryAfterRequestSequence,
      phaseDiagnostics: phaseCaptures.flatMap(capture => capture.records()).slice(-128),
      queryEmbeddingRequests: queryEmbeddingStart === undefined ? undefined : model.counts.embedding - queryEmbeddingStart,
      model: model.counts, transport: fixture?.diagnostics(), cleanupCompleted, closed, profileRemoved
    });
    console.info(`PACKAGED_TEAM_SESSION_RECEIPT: ${receiptPath}`);
  }
  if (passed && closed && profileRemoved) {
    console.log(`PACKAGED_TEAM_SESSION_PASS: asar=${asarSha256}; product UI device login, binding, sync, Pi provenance, cold login restoration, revoked project sync denial, logout and physical exit; ${native ? "signed native index, Pi search/read exact published body, revoked history denied before models" : "native team retrieval not tested"}`);
  }
}
