import { spawn } from "node:child_process";
import { once } from "node:events";

const root = new URL("../../", import.meta.url);
const children = new Set();

await run("corepack", ["pnpm", "run", "build"]);

start("corepack", ["pnpm", "--filter", "@pi67/renderer", "run", "dev"]);
await waitFor("http://127.0.0.1:5173", 30_000);
const electron = start("corepack", ["pnpm", "exec", "electron", "."], {
  PI67_RENDERER_DEV_URL: "http://127.0.0.1:5173"
});

await once(electron, "exit");
shutdown();

function start(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function run(command, args) {
  const child = start(command, args);
  const [code] = await once(child, "exit");
  if (code !== 0) process.exit(code ?? 1);
}

async function waitFor(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
