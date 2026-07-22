import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyToolCall } from "../src/risk-policy.mjs";

test("workspace read and write paths are automatic", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi67-safety-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, "src"));
  const read = await classifyToolCall({ toolName: "read", input: { path: "src/file.cs" } }, workspace);
  const write = await classifyToolCall({ toolName: "write", input: { path: "src/new.cs" } }, workspace);
  assert.equal(read.approvalRequired, false);
  assert.equal(write.approvalRequired, false);
});

test("symlink escape requires approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pi67-safety-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const external = join(root, "external");
  await mkdir(workspace);
  await mkdir(external);
  await symlink(external, join(workspace, "escape"), "dir");
  const risk = await classifyToolCall({ toolName: "write", input: { path: "escape/file.txt" } }, workspace);
  assert.equal(risk.approvalRequired, true);
  assert.equal(risk.category, "external_path");
});

test("destructive and external bash actions require one-shot approval", async () => {
  const destructive = await classifyToolCall({ toolName: "bash", input: { command: "rm -rf build" } }, process.cwd());
  const push = await classifyToolCall({ toolName: "bash", input: { command: "git push origin main" } }, process.cwd());
  const status = await classifyToolCall({ toolName: "bash", input: { command: "git status --short" } }, process.cwd());
  assert.equal(destructive.category, "bulk_delete");
  assert.equal(push.category, "git_external_action");
  assert.equal(status.approvalRequired, false);
});

test("shell reads that can escape or execute helpers fail closed", async () => {
  const externalRead = await classifyToolCall({ toolName: "bash", input: { command: "cat /etc/passwd" } }, process.cwd());
  const preprocessor = await classifyToolCall({ toolName: "bash", input: { command: "rg --pre ./helper needle" } }, process.cwd());
  const outputWrite = await classifyToolCall({ toolName: "bash", input: { command: "git diff --output=../outside.patch" } }, process.cwd());

  assert.equal(externalRead.approvalRequired, true);
  assert.equal(preprocessor.approvalRequired, true);
  assert.equal(outputWrite.approvalRequired, true);
});
