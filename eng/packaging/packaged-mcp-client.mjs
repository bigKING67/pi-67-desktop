import { spawn } from "node:child_process";
import { access, lstat } from "node:fs/promises";
import { createInterface } from "node:readline";

export async function probePackagedMcpServer({
  name,
  spec,
  expectedServerName,
  toolName,
  toolArguments,
  cwd,
  environment = process.env
}) {
  assertMcpSpec(name, spec);
  await assertRegularFile(spec.command, `${name} command`);
  await Promise.all(spec.args.map((path) => assertRegularFile(path, `${name} entrypoint`)));

  const child = spawn(spec.command, spec.args, {
    cwd,
    env: { ...environment },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = new Map();
  let stderr = "";
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${name} MCP error: ${JSON.stringify(message.error)}`));
    else request.resolve(message.result);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_000);
  });
  child.once("error", (error) => rejectPending(pending, error));
  child.once("exit", (code, signal) => {
    if (pending.size === 0) return;
    rejectPending(pending, new Error(
      `${name} MCP exited ${signal ? `via ${signal}` : `with code ${String(code)}`}; stderr=${stderr}`
    ));
  });

  const request = (id, method, params) => requestJsonRpc({
    child,
    id,
    method,
    name,
    params,
    pending,
    stderr: () => stderr
  });
  try {
    const initialized = await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi67-packaged-live-smoke", version: "1.0.0" }
    });
    assert(initialized.serverInfo?.name === expectedServerName, `${name} server identity mismatch`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const listed = await request(2, "tools/list");
    assert(Array.isArray(listed.tools), `${name} tools/list is invalid`);
    assert(listed.tools.some((tool) => tool.name === toolName), `${name} is missing ${toolName}`);

    const called = await request(3, "tools/call", {
      name: toolName,
      arguments: toolArguments
    });
    const text = called.content?.find((item) => item.type === "text")?.text;
    assert(typeof text === "string", `${name} tool response is missing text content`);
    return {
      outcome: JSON.parse(text),
      serverInfo: initialized.serverInfo,
      toolCount: listed.tools.length
    };
  } finally {
    child.stdin.end();
    await stopChild(child);
  }
}

function requestJsonRpc({ child, id, method, name, params, pending, stderr }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${name} ${method} timed out; stderr=${stderr()}`));
    }, 15_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {})
    })}\n`);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timeout = new Promise((resolve) => setTimeout(resolve, 5_000, "timeout"));
  if (await Promise.race([exited, timeout]) === "timeout") {
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
}

function rejectPending(pending, error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function assertMcpSpec(name, spec) {
  assert(
    spec && typeof spec.command === "string" && Array.isArray(spec.args) && spec.args.length > 0,
    `${name} MCP spec is missing`
  );
}

async function assertRegularFile(path, label) {
  await access(path);
  const metadata = await lstat(path);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
