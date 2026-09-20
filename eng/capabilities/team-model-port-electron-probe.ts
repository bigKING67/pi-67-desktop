import { app, utilityProcess } from "electron";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { TeamModelPortSupervisor } from "../../apps/desktop/src/team-model-port-supervisor.js";

const directory = process.env.PI67_TEAM_PORT_PROBE_DIR;
if (!directory || resolve(directory) !== directory) app.exit(1);
else {
  app.setPath("userData", directory);
  void app.whenReady().then(async () => {
    for (const mode of ["abort", "host-exit", "unreserved"] as const) await probe(mode);
    console.log("TEAM_MODEL_PORT_ELECTRON_PASS: real utility transfer, bidirectional bytes, owner abort, Host exit, unreserved rejection");
    app.exit(0);
  }).catch(() => { console.error("TEAM_MODEL_PORT_ELECTRON_FAILED: synthetic transport or lifecycle check failed"); app.exit(1); });
}

async function probe(mode: "abort" | "host-exit" | "unreserved") {
  const host = utilityProcess.fork(fileURLToPath(new URL("./team-model-port-utility-probe.mjs", import.meta.url)), [], {
    stdio: "ignore", cwd: directory!, env: { PATH: process.env.PATH ?? "" }
  });
  let exited = false, complete = false;
  const exit = new Promise<void>(resolveExit => { host.once("exit", () => { exited = true; resolveExit(); }); });
  const supervisor = new TeamModelPortSupervisor(() => exited ? undefined : host);
  const payload = Buffer.alloc(180_000, 42), received: Buffer[] = [];
  let finish!: () => void, fail!: () => void;
  const done = new Promise<void>((yes, no) => { finish = () => { complete = true; yes(); }; fail = () => no(new Error("Synthetic probe failed.")); });
  const native = new Duplex({ read() {}, write(bytes: Buffer, _encoding, callback) {
    received.push(Buffer.from(bytes)); callback();
    const result = Buffer.concat(received);
    if (result.length < payload.length) return;
    if (!result.equals(payload) || mode === "unreserved") { fail(); return; }
    if (mode === "abort") supervisor.invalidate(); else host.kill();
  } });
  native.once("close", () => { if (mode === "unreserved" || mode === "host-exit" && exited) finish(); });
  host.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || !("type" in message)) { fail(); return; }
    if (message.type === "probe-closed" && mode === "abort") { if (native.destroyed) finish(); else fail(); return; }
    if (message.type !== "probe-reserved" || !("requestId" in message) || typeof message.requestId !== "string") { fail(); return; }
    try {
      supervisor.attach(mode === "unreserved" ? "11111111-1111-4111-8111-111111111111" : message.requestId, native, new AbortController().signal);
      if (mode !== "unreserved") { native.push(payload.subarray(0, 90_000)); native.push(payload.subarray(90_000)); }
    } catch { fail(); }
  });
  const timer = setTimeout(fail, 15_000);
  try { await done; }
  finally {
    clearTimeout(timer); supervisor.invalidate(); native.destroy();
    if (!exited) host.kill();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([exit, new Promise<never>((_resolve, reject) => { cleanupTimer = setTimeout(() => reject(new Error("Utility cleanup unconfirmed.")), 5_000); })]); }
    finally { clearTimeout(cleanupTimer); }
  }
  if (!complete || !native.destroyed || !exited) throw new Error("Synthetic lifecycle incomplete.");
}
