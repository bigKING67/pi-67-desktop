import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LfJsonDecoder } from "../src/protocol.mjs";

const packageRoot = process.env.PI67_TEST_PI_PACKAGE_ROOT;

test("bridge loads the selected installed Pi package", { skip: !packageRoot }, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn(process.execPath, [resolve(root, "src", "index.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PI67_DESKTOP_PI_PACKAGE_ROOT: packageRoot,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
      PI67_DESKTOP_WORKSPACE: process.env.PI67_TEST_WORKSPACE ?? process.cwd(),
      PI67_DESKTOP: "1",
      PI_TELEMETRY: "0",
    },
  });
  const decoder = new LfJsonDecoder();
  const response = new Promise((accept, reject) => {
    child.stdout.on("data", (chunk) => {
      try {
        for (const value of decoder.push(chunk)) {
          if (value.id === "smoke-1") accept(value);
        }
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Bridge exited with ${code}`));
    });
  });

  child.stdin.end(`${JSON.stringify({ id: "smoke-1", action: "capabilities" })}\n`);
  const result = await response;
  assert.equal(result.success, true);
  assert.equal(typeof result.data.piVersion, "string");
  assert.ok(result.data.actions.includes("models.list"));
});
