import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { release } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LocalMemoryStartupTrace } from "./local-memory-startup.mjs";

export interface OpenVikingModelConfiguration {
  protocol: "openai-compatible";
  endpoint: string;
  model: string;
  apiKey: string;
}

interface NativeOptions {
  /** Main must verify the runtime manifest and tree before supplying this path. */
  python: string;
  dataRoot: string;
  localProfileId: string;
  embedding: OpenVikingModelConfiguration & { dimension: number };
  extraction: OpenVikingModelConfiguration;
  startupTrace?: LocalMemoryStartupTrace;
}

export interface NativeOpenVikingConnection {
  endpoint: string;
  apiKey: string;
  account: string;
  user: string;
  localProfileId: string;
}

export interface NativeOpenVikingHandle {
  connection: NativeOpenVikingConnection;
  /** Main-only scope provisioning; never pass this handle to Host or Renderer. */
  provisionScope(account: string): Promise<NativeOpenVikingConnection>;
  stop(): Promise<void>;
}

function modelConfiguration(model: OpenVikingModelConfiguration) {
  const endpoint = new URL(model.endpoint);
  if (model.protocol !== "openai-compatible" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:"
      && ["127.0.0.1", "[::1]"].includes(endpoint.hostname)))
    || !model.model.trim() || !model.apiKey.trim()) throw new Error("Invalid explicit OpenViking model configuration.");
  return { provider: "openai", model: model.model, api_key: model.apiKey, api_base: model.endpoint };
}

/** Native macOS adapter. Windows requires its own verified process-tree containment. */
export async function startNativeOpenViking(
  options: NativeOptions, signal: AbortSignal, onExit: () => void
): Promise<NativeOpenVikingHandle> {
  signal.throwIfAborted();
  if (process.platform !== "darwin" || process.arch !== "arm64" || Number(release().split(".")[0]) < 23) {
    throw new Error("Managed OpenViking currently requires verified macOS 14+ arm64 process containment.");
  }
  if (!isAbsolute(options.python) || !isAbsolute(options.dataRoot)
    || !/^[0-9a-f-]{36}$/u.test(options.localProfileId)
    || !Number.isSafeInteger(options.embedding.dimension) || options.embedding.dimension < 1
    || options.embedding.dimension > 65_536) throw new Error("Invalid native OpenViking startup configuration.");
  const embedding = modelConfiguration(options.embedding);
  const extraction = modelConfiguration(options.extraction);
  await mkdir(options.dataRoot, { recursive: true, mode: 0o700 });
  const rootMetadata = await lstat(options.dataRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error("Unsafe native data directory.");
  const data = join(options.dataRoot, "data");
  await mkdir(data, { recursive: true, mode: 0o700 });
  const dataMetadata = await lstat(data);
  if (dataMetadata.isSymbolicLink() || !dataMetadata.isDirectory()) throw new Error("Unsafe native data directory.");
  await chmod(options.dataRoot, 0o700);
  await chmod(data, 0o700);
  const runDirectory = await mkdtemp(join(options.dataRoot, ".run-"));
  const rootKey = randomBytes(32).toString("hex");
  let endpoint: string;
  let configuration: string;
  try {
    const reservation = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => {
        const address = reservation.address();
        if (!address || typeof address === "string") { reservation.close(); reject(new Error("Unable to reserve a local port.")); return; }
        reservation.close((error) => error ? reject(error) : resolve(address.port));
      });
    });
    endpoint = `http://127.0.0.1:${port}`;
    configuration = join(runDirectory, "ov.conf");
    let serialized = JSON.stringify({
      storage: { workspace: data }, server: { host: "127.0.0.1", port, root_api_key: "${NEWMONEY_OV_ROOT_KEY}" },
      embedding: { dense: { ...embedding, api_key: "${NEWMONEY_OV_EMBEDDING_KEY}",
        dimension: options.embedding.dimension, input: "text", encoding_format: "float" } },
      vlm: { ...extraction, api_key: "${NEWMONEY_OV_EXTRACTION_KEY}" }
    }).replaceAll("$", "\\u0024");
    // Expand only our three secret fields. User paths/model names/URLs containing
    // dollars must not be interpreted as references to the child credentials.
    for (const [field, variable] of [["root_api_key", "NEWMONEY_OV_ROOT_KEY"],
      ["api_key", "NEWMONEY_OV_EMBEDDING_KEY"], ["api_key", "NEWMONEY_OV_EXTRACTION_KEY"]] as const) {
      const reference = JSON.stringify({ [field]: "${" + variable + "}" }).slice(1, -1);
      serialized = serialized.replace(reference.replaceAll("$", "\\u0024"), reference);
    }
    await writeFile(configuration, serialized, { mode: 0o600 });
    signal.throwIfAborted();
  } catch (error) {
    await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(options.python, ["-I", "-B", "-c",
    "from openviking_cli.server_bootstrap import main; main()", "--config", configuration], {
    cwd: runDirectory, detached: true, stdio: "ignore",
    env: { PATH: "/usr/bin:/bin", PYTHONUNBUFFERED: "1", LITELLM_LOCAL_MODEL_COST_MAP: "True", OPENVIKING_CONFIG_FILE: configuration,
      // OpenViking expands environment references before JSON parsing. Escape the
      // string contents so quotes/backslashes in configured keys cannot alter JSON.
      NEWMONEY_OV_ROOT_KEY: JSON.stringify(rootKey).slice(1, -1),
      NEWMONEY_OV_EMBEDDING_KEY: JSON.stringify(options.embedding.apiKey).slice(1, -1),
      NEWMONEY_OV_EXTRACTION_KEY: JSON.stringify(options.extraction.apiKey).slice(1, -1) }
    });
  } catch {
    await rm(runDirectory, { recursive: true, force: true });
    throw new Error("Native OpenViking process could not be launched.");
  }
  let exited = false;
  let spawned = true;
  let stopPromise: Promise<void> | undefined;
  const exit = new Promise<void>((resolve) => {
    const finished = () => {
      exited = true;
      resolve();
      onExit();
      // Clean descendants and temporary launch config promptly after a crash,
      // not on a later connect that might encounter a reused process-group ID.
      void stop().catch(() => console.error("Native OpenViking cleanup failed."));
    };
    child.once("error", () => { spawned = false; finished(); });
    child.once("exit", finished);
  });
  function killGroup(killSignal: NodeJS.Signals) {
    if (!child.pid || !spawned) return;
    try { process.kill(-child.pid, killSignal); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
  }
  async function stop() {
    stopPromise ??= (async () => {
      try {
        killGroup("SIGTERM");
        await waitForExit(3_000);
        // Terminate descendants even if the Python parent has already exited.
        killGroup("SIGKILL");
        if (!exited) await waitForExit(2_000);
        if (!exited) throw new Error("Native OpenViking process did not terminate.");
      } finally {
        if (exited) await rm(runDirectory, { recursive: true, force: true });
      }
    })();
    return stopPromise;
  }
  async function waitForExit(timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async function admin(path: string, body: object) {
    signal.throwIfAborted();
    const response = await fetch(`${endpoint}/api/v1/admin${path}`, {
      method: "POST", redirect: "error", headers: { "X-API-Key": rootKey, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)])
    });
    if (response.status === 409) { await response.body?.cancel(); return undefined; }
    if (!response.ok) { await response.body?.cancel(); throw new Error("Native scope provisioning failed."); }
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || !("result" in value)
      || typeof value.result !== "object" || value.result === null) throw new Error("Invalid native scope response.");
    return value.result as Record<string, unknown>;
  }
  async function provisionScope(account: string): Promise<NativeOpenVikingConnection> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(account) || exited) throw new Error("Invalid native scope request.");
    await admin("/accounts", { account_id: account, admin_user_id: "scope-owner" });
    const user = "desktop";
    const created = await admin(`/accounts/${account}/users`, { user_id: user, role: "user" });
    const credentials = created ?? await admin(`/accounts/${account}/users/${user}/key`, {});
    const apiKey = credentials?.user_key;
    if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.length > 4_096 || apiKey === rootKey) {
      throw new Error("Native scope credential is unavailable.");
    }
    return { endpoint, apiKey, account, user, localProfileId: options.localProfileId };
  }
  try {
    const trace = options.startupTrace ?? new LocalMemoryStartupTrace();
    await trace.measure("process-ready", async () => {
      let ready = false;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !exited) {
        signal.throwIfAborted();
        try {
          const response = await fetch(`${endpoint}/health`, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(500)]) });
          ready = response.ok;
          await response.body?.cancel();
          if (ready) break;
        } catch { signal.throwIfAborted(); }
        await delay(100, undefined, { signal });
      }
      if (!ready || exited) throw new Error("Native OpenViking startup failed.");
    });
    const connection = await trace.measure("scope-provisioning", () => provisionScope(`private-${options.localProfileId}`));
    return { connection, provisionScope, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
