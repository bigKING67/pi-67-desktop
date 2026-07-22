import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { LfJsonDecoder, bridgeError, publicError, validateRequest } from "./protocol.mjs";
import {
  createPiServices,
  inspectSettings,
  inspectTrust,
  loadInstalledPi,
  summarizeAuth,
  summarizeModels,
} from "./pi-api.mjs";

const packageRoot = process.env.PI67_DESKTOP_PI_PACKAGE_ROOT;
const agentDirectory = process.env.PI_CODING_AGENT_DIR;
const workspace = process.env.PI67_DESKTOP_WORKSPACE;

if (!agentDirectory || !workspace) {
  process.stderr.write("Pi-67 Desktop bridge requires agent directory and workspace environment values.\n");
  process.exitCode = 2;
} else {
  const decoder = new LfJsonDecoder();
  const pendingInteractions = new Map();
  const oauthControllers = new Map();
  const activeRequests = new Set();
  let outputQueue = Promise.resolve();
  let servicesPromise;

  const send = (payload) => {
    const line = `${JSON.stringify(payload)}\n`;
    outputQueue = outputQueue.then(() => new Promise((accept, reject) => {
      process.stdout.write(line, (error) => error ? reject(error) : accept());
    }));
    return outputQueue;
  };

  const services = async () => {
    servicesPromise ??= loadInstalledPi(packageRoot).then((api) => createPiServices(api, {
      agentDirectory: resolve(agentDirectory),
      workspace: resolve(workspace),
    }));
    return servicesPromise;
  };

  const interact = async (flowId, stage, details) => {
    const interactionId = randomUUID();
    const value = new Promise((accept, reject) => pendingInteractions.set(interactionId, { flowId, accept, reject }));
    await send({ id: flowId, type: "event", event: "oauth", data: { interactionId, stage, ...details } });
    return value;
  };

  const execute = async (request) => {
    const pi = await services();
    switch (request.action) {
      case "capabilities":
        return { bridgeVersion: "0.1.0-alpha.1", piVersion: pi.api.VERSION ?? null, actions: [
          "auth.status", "auth.setApiKey", "auth.loginOAuth", "auth.logout",
          "models.list", "models.refresh", "settings.inspect", "settings.updateDefaults",
          "trust.inspect", "trust.set", "oauth.respond", "oauth.cancel",
        ] };
      case "auth.status":
        return summarizeAuth(pi);
      case "auth.setApiKey": {
        const { providerId, apiKey } = request.params;
        if (typeof providerId !== "string" || providerId.trim() === "" || typeof apiKey !== "string" || apiKey === "") {
          throw bridgeError("bridge.invalid_auth_input", "Provider and API key are required");
        }
        pi.authStorage.set(providerId, { type: "api_key", key: apiKey });
        request.params.apiKey = undefined;
        return { configured: true };
      }
      case "auth.logout":
        pi.authStorage.logout(requireString(request.params.providerId, "providerId"));
        return { configured: false };
      case "auth.loginOAuth": {
        const providerId = requireString(request.params.providerId, "providerId");
        const controller = new AbortController();
        oauthControllers.set(request.id, controller);
        try {
          await pi.authStorage.login(providerId, {
            signal: controller.signal,
            onAuth: (info) => void send({ id: request.id, type: "event", event: "oauth", data: { stage: "authorization", message: info.instructions ?? "Open the authorization page.", authorizationUri: info.url } }),
            onDeviceCode: (info) => void send({ id: request.id, type: "event", event: "oauth", data: { stage: "device_code", message: "Enter the device code in the authorization page.", authorizationUri: info.verificationUri, userCode: info.userCode } }),
            onProgress: (message) => void send({ id: request.id, type: "event", event: "oauth", data: { stage: "progress", message } }),
            onPrompt: (prompt) => interact(request.id, "prompt", { message: prompt.message, placeholder: prompt.placeholder ?? null, allowEmpty: prompt.allowEmpty === true }),
            onManualCodeInput: () => interact(request.id, "manual_code", { message: "Paste the authorization code.", placeholder: null, allowEmpty: false }),
            onSelect: (prompt) => interact(request.id, "select", { message: prompt.message, choices: prompt.options }),
          });
          return { configured: true };
        } finally {
          oauthControllers.delete(request.id);
        }
      }
      case "oauth.respond": {
        const interactionId = requireString(request.params.interactionId, "interactionId");
        const pending = pendingInteractions.get(interactionId);
        if (!pending || pending.flowId !== request.params.flowId) {
          throw bridgeError("bridge.oauth_interaction_missing", "OAuth interaction is no longer active");
        }
        pendingInteractions.delete(interactionId);
        pending.accept(request.params.value);
        return { accepted: true };
      }
      case "oauth.cancel": {
        const flowId = requireString(request.params.flowId, "flowId");
        oauthControllers.get(flowId)?.abort();
        for (const [id, pending] of pendingInteractions) {
          if (pending.flowId === flowId) {
            pendingInteractions.delete(id);
            pending.reject(bridgeError("bridge.oauth_cancelled", "OAuth login was cancelled"));
          }
        }
        return { cancelled: true };
      }
      case "models.list":
        return summarizeModels(pi);
      case "models.refresh":
        pi.modelRegistry.refresh();
        return { refreshed: true };
      case "settings.inspect":
        return inspectSettings(pi);
      case "settings.updateDefaults":
        pi.settingsManager.setDefaultModelAndProvider(
          requireString(request.params.providerId, "providerId"),
          requireString(request.params.modelId, "modelId"),
        );
        await pi.settingsManager.flush();
        return inspectSettings(pi);
      case "trust.inspect":
        return inspectTrust(pi, requireString(request.params.workspacePath, "workspacePath"));
      case "trust.set": {
        const target = requireString(request.params.workspacePath, "workspacePath");
        const decision = requireString(request.params.decision, "decision");
        if (decision === "trustAndPersist") pi.trustStore.set(target, true);
        else if (decision === "deny") pi.trustStore.set(target, false);
        else if (decision !== "trustOnce") throw bridgeError("bridge.invalid_trust_decision", "Unknown project trust decision");
        const status = inspectTrust(pi, target);
        return decision === "trustOnce" ? { ...status, state: "trustedForProcess", persisted: false } : status;
      }
      default:
        throw bridgeError("bridge.action_not_supported", `Unsupported bridge action: ${request.action}`);
    }
  };

  const dispatch = async (value) => {
    let request;
    try {
      request = validateRequest(value);
      const data = await execute(request);
      await send({ id: request.id, type: "response", success: true, data });
    } catch (error) {
      await send({ id: request?.id ?? null, type: "response", success: false, error: publicError(error) });
    }
  };

  process.stdin.on("data", (chunk) => {
    try {
      for (const value of decoder.push(chunk)) {
        const active = dispatch(value).finally(() => activeRequests.delete(active));
        activeRequests.add(active);
      }
    } catch (error) {
      void send({ id: null, type: "response", success: false, error: publicError(error) }).finally(() => process.exit(2));
    }
  });
  process.stdin.on("end", () => {
    try {
      decoder.finish();
    } catch (error) {
      void send({ id: null, type: "response", success: false, error: publicError(error) });
    }
    void Promise.allSettled([...activeRequests])
      .then(() => outputQueue)
      .then(() => process.exit(process.exitCode ?? 0));
  });
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw bridgeError("bridge.invalid_request", `${name} must be a non-empty string`);
  }
  return value.trim();
}
