import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = process.platform === "darwin" && process.arch === "arm64"
  ? ["--mac", "dir", "--arm64", "-c.mac.notarize=false", "-c.mac.hardenedRuntime=false"]
  : process.platform === "win32" && process.arch === "x64"
    ? ["--win", "dir", "--x64"]
    : undefined;

if (!target) throw new Error(`Performance packaging does not support ${process.platform}/${process.arch}.`);

const child = spawn("corepack", ["pnpm", "exec", "electron-builder", ...target], {
  cwd: root,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  stdio: "inherit",
  shell: process.platform === "win32"
});
const [code] = await once(child, "exit");
if (code !== 0) throw new Error(`Performance package preparation failed with exit code ${code}.`);
