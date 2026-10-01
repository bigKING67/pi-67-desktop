import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EXPECTED_SERVER_VERSION = "0.4.16";

/**
 * Reads the repository-external credential file. Only key-free identity fields
 * are returned in `public`; secrets stay in `secret` and are passed to the child
 * through its environment only.
 */
export function readCredentials(path, { withExpansion }) {
  if (!path) throw new Error("Pass --credentials with a repository-external mode-0600 JSON file.");
  const absolute = resolve(path);
  if (absolute.startsWith(`${repositoryRoot}/`)) throw new Error("The credential file must live outside the repository.");
  const mode = statSync(absolute).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error("The credential file must not be group/world accessible.");
  const config = JSON.parse(readFileSync(absolute, "utf8"));
  const embedding = modelSection(config.embedding, "embedding");
  const dimension = Number(config.embedding.dimension);
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 65_536) throw new Error("Invalid embedding.dimension.");
  const vlm = withExpansion ? modelSection(config.vlm, "vlm") : null;
  return {
    secret: { embeddingKey: embedding.apiKey, vlmKey: vlm?.apiKey ?? null },
    public: {
      embedding: { apiBase: embedding.apiBase, model: embedding.model, dimension },
      vlm: vlm ? { apiBase: vlm.apiBase, model: vlm.model, ...extraRequestBody(config.vlm) } : null,
    },
  };
}

/** Optional non-secret provider switches such as `{"enable_thinking": false}` for hybrid-reasoning models. */
function extraRequestBody(section) {
  const extra = section?.extra_request_body;
  if (extra === undefined) return {};
  if (!extra || typeof extra !== "object" || Array.isArray(extra)
    || Object.values(extra).some((value) => !["boolean", "number", "string"].includes(typeof value))) {
    throw new Error("vlm.extra_request_body must be a flat object of primitive values.");
  }
  return { extraRequestBody: extra };
}

function modelSection(section, name) {
  const apiBase = String(section?.api_base ?? "").trim();
  const model = String(section?.model ?? "").trim();
  const apiKey = String(section?.api_key ?? "").trim();
  if (!apiBase || !model || !apiKey) throw new Error(`Credential file is missing ${name}.api_base/model/api_key.`);
  const url = new URL(apiBase);
  if (url.protocol !== "https:" || url.username || url.password || url.search) throw new Error(`${name}.api_base must be credential-free HTTPS.`);
  return { apiBase, model, apiKey };
}

/** Newest prepared native runtime that contains the expected OpenViking version. */
export function resolvePython(explicit) {
  if (explicit) return resolve(explicit);
  const root = join(repositoryRoot, "artifacts/openviking-native");
  const candidates = existsSync(root) ? readdirSync(root)
    .map((name) => join(root, name, "runtime"))
    .filter((runtime) => existsSync(join(runtime, "bin/python"))
      && existsSync(join(runtime, `lib/python3.12/site-packages/openviking-${EXPECTED_SERVER_VERSION}.dist-info`)))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs) : [];
  if (!candidates.length) throw new Error(`No prepared OpenViking ${EXPECTED_SERVER_VERSION} runtime under artifacts/openviking-native; pass --python.`);
  return join(candidates[0], "bin/python");
}

/**
 * Starts a loopback dev-mode server (no root key: every request is local ROOT
 * and identity comes from headers) on a temporary data root. Without
 * `withExpansion` no VLM is configured and intent analysis is disabled, so no
 * LLM call is possible; only embeddings are requested.
 */
export async function startDisposableServer({ python, credentials, withExpansion, intentTimeoutS }) {
  const root = await mkdtemp(join(tmpdir(), "pi67-ov-baseline-"));
  await chmod(root, 0o700);
  let child;
  let exited = false;
  const stop = async () => {
    try {
      if (child?.pid && !exited) {
        killGroup(child.pid, "SIGTERM");
        for (let waited = 0; waited < 5_000 && !exited; waited += 100) await delay(100);
        if (!exited) killGroup(child.pid, "SIGKILL");
        for (let waited = 0; waited < 2_000 && !exited; waited += 100) await delay(100);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    return { dataRootRemoved: !existsSync(root), processExited: !child || exited };
  };
  try {
    const port = await reservePort();
    const workspace = join(root, "data");
    await mkdir(workspace, { mode: 0o700 });
    const configuration = {
      storage: { workspace },
      server: { host: "127.0.0.1", port },
      embedding: { dense: {
        provider: "openai", model: credentials.public.embedding.model, api_base: credentials.public.embedding.apiBase,
        api_key: "${PI67_EVAL_EMBEDDING_KEY}", dimension: credentials.public.embedding.dimension,
        input: "text", encoding_format: "float",
      } },
      retrieval: { enable_intent: withExpansion, ...(intentTimeoutS ? { recall_intent_timeout_s: intentTimeoutS } : {}) },
      ...(withExpansion ? { vlm: {
        provider: "openai", model: credentials.public.vlm.model, api_base: credentials.public.vlm.apiBase,
        api_key: "${PI67_EVAL_VLM_KEY}",
        ...(credentials.public.vlm.extraRequestBody ? { extra_request_body: credentials.public.vlm.extraRequestBody } : {}),
      } } : {}),
    };
    const configPath = join(root, "ov.conf");
    await writeFile(configPath, JSON.stringify(configuration), { mode: 0o600 });
    child = spawn(python, ["-I", "-B", "-c", "from openviking_cli.server_bootstrap import main; main()", "--config", configPath], {
      cwd: root, detached: true, stdio: "ignore",
      env: {
        PATH: "/usr/bin:/bin", HOME: root, PYTHONUNBUFFERED: "1", LITELLM_LOCAL_MODEL_COST_MAP: "True",
        OPENVIKING_CONFIG_FILE: configPath,
        PI67_EVAL_EMBEDDING_KEY: jsonEscape(credentials.secret.embeddingKey),
        ...(withExpansion ? { PI67_EVAL_VLM_KEY: jsonEscape(credentials.secret.vlmKey) } : {}),
      },
    });
    child.once("exit", () => { exited = true; });
    child.once("error", () => { exited = true; });
    const endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (exited) throw new Error("OpenViking exited during startup.");
      if (Date.now() > deadline) throw new Error("OpenViking did not become healthy within 90s.");
      try {
        const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1_000) });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return { endpoint, version: String(body.version ?? body.result?.version ?? "unknown"), stop };
      } catch { /* not ready */ }
      await delay(300);
    }
  } catch (error) {
    await stop();
    throw error;
  }
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; }
}

function jsonEscape(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      reservation.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}
