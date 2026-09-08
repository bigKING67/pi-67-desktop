import { describe, expect, it, vi } from "vitest";
import { parsePreflightArguments, preflightWindowsCandidate } from "./windows-candidate-preflight.mjs";

function fixture() {
  const sourceSha = "a".repeat(40);
  const oldSha = "b".repeat(40);
  const version = "0.1.0-alpha.39";
  const baseline = {
    schema: "pi67.windows-preview-candidate.v1", channel: "unsigned-preview-candidate", signed: false,
    repository: "owner/repo", workflow: { name: "Windows candidate", runId: "42", runAttempt: "1" },
    source: { policy: "main", commit: oldSha },
    application: { product: "Pi-67 Desktop", version, platform: "win32", architecture: "x64", runtime: "@earendil-works/pi-coding-agent@0.84.3" },
    installer: { fileName: `New-Money-${version}-win-x64.exe`, byteLength: 10, sha256: "c".repeat(64) },
    packagedExecutable: { fileName: "win-unpacked/New Money.exe", byteLength: 10, sha256: "d".repeat(64) }
  };
  const packageFile = (value) => ({ encoding: "base64", content: Buffer.from(JSON.stringify({ name: "pi-67-desktop", version: value })).toString("base64") });
  const responses = {
    "commits/main": { sha: sourceSha },
    [`compare/${sourceSha}...${sourceSha}`]: { status: "identical" },
    [`contents/package.json?ref=${sourceSha}`]: packageFile("0.1.0-alpha.40"),
    [`contents/package.json?ref=${oldSha}`]: packageFile(version),
    "actions/runs/42/attempts/1": { id: 42, run_attempt: 1, path: ".github/workflows/windows-candidate.yml", status: "completed", conclusion: "failure" },
    "actions/runs/42/attempts/2": { id: 42, run_attempt: 2, path: ".github/workflows/windows-candidate.yml", status: "completed", conclusion: "success" },
    "actions/runs/42/attempts/1/jobs?per_page=100": { total_count: 1, jobs: [{ name: "build-windows", conclusion: "success" }] },
    "actions/runs/42/attempts/2/jobs?per_page=100": { total_count: 1, jobs: ["certify-installer"].map((name) => ({ name, conclusion: "success" })) },
    "actions/runs/42/artifacts?per_page=100&page=1": { artifacts: [{ name: "windows-candidate-42-2", expired: false, size_in_bytes: 100 }] }
  };
  const query = vi.fn(async (endpoint) => {
    if (!(endpoint in responses)) throw new Error(`Unexpected endpoint: ${endpoint}`);
    return responses[endpoint];
  });
  return { options: { repository: "owner/repo", sourceSha, baseline, artifactAttempt: "2", query }, responses };
}

describe("Windows candidate metadata preflight", () => {
  it("preserves separate successful upload and original build attempts", async () => {
    const { options } = fixture();
    const result = await preflightWindowsCandidate(options);
    expect(result.workflowInputs).toMatchObject({ baseline_run_attempt: "1", baseline_artifact_run_attempt: "2", source_sha: options.sourceSha });
    expect(result.artifactBytes).toContain("NOT_VERIFIED");
  });
  it("rejects short SHA before remote queries", async () => {
    const { options } = fixture();
    await expect(preflightWindowsCandidate({ ...options, sourceSha: "abc1234" })).rejects.toThrow("full lowercase");
    expect(options.query).not.toHaveBeenCalled();
  });
  it("rejects same-version upgrade baselines", async () => {
    const { options, responses } = fixture();
    responses[`contents/package.json?ref=${options.sourceSha}`] = responses[`contents/package.json?ref=${options.baseline.source.commit}`];
    await expect(preflightWindowsCandidate(options)).rejects.toThrow("older than");
  });
  it("rejects a source off remote main", async () => {
    const { options, responses } = fixture();
    responses[`compare/${options.sourceSha}...${options.sourceSha}`].status = "diverged";
    await expect(preflightWindowsCandidate(options)).rejects.toThrow("not reachable");
  });
  it.each(["expired", "missing", "duplicate"])("rejects %s artifacts", async (mode) => {
    const { options, responses } = fixture();
    const inventory = responses["actions/runs/42/artifacts?per_page=100&page=1"];
    if (mode === "expired") inventory.artifacts[0].expired = true;
    if (mode === "missing") inventory.artifacts = [];
    if (mode === "duplicate") inventory.artifacts.push({ ...inventory.artifacts[0] });
    await expect(preflightWindowsCandidate(options)).rejects.toThrow("artifact is missing");
  });
  it("rejects unsuccessful certification even if an artifact exists", async () => {
    const { options, responses } = fixture();
    responses["actions/runs/42/attempts/2/jobs?per_page=100"].jobs[0].conclusion = "failure";
    await expect(preflightWindowsCandidate(options)).rejects.toThrow("required jobs");
  });
  it("rejects identity/source version mismatch", async () => {
    const { options, responses } = fixture();
    responses[`contents/package.json?ref=${options.baseline.source.commit}`] = responses[`contents/package.json?ref=${options.sourceSha}`];
    await expect(preflightWindowsCandidate(options)).rejects.toThrow("match its source version");
  });
  it("rejects API failure without dispatching or reporting success", async () => {
    const { options } = fixture();
    options.query.mockRejectedValue(new Error("API unavailable"));
    await expect(preflightWindowsCandidate(options)).rejects.toThrow("API unavailable");
  });
  it("rejects duplicate and incomplete CLI arguments", () => {
    expect(() => parsePreflightArguments(["--source-sha", "a", "--source-sha", "b"])).toThrow("unique");
    expect(() => parsePreflightArguments(["--source-sha"])).toThrow("pairs");
  });
});
