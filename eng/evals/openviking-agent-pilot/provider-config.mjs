import { readFileSync, statSync } from "node:fs";

export function readPilotCredentials(configPath) {
  if (!configPath) {
    throw new Error("Pass --root-config with the repository-external OpenViking laboratory configuration.");
  }
  const mode = statSync(configPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("The external OpenViking laboratory configuration must not be group/world accessible.");
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const rootKey = requiredString(config?.server?.root_api_key, "server.root_api_key");
  const providerKey = requiredString(config?.vlm?.api_key, "vlm.api_key");
  const providerBaseUrl = normalizeHttpsBaseUrl(requiredString(config?.vlm?.api_base, "vlm.api_base"));
  const modelId = requiredIdentifier(config?.vlm?.model, "vlm.model");
  return {
    secret: { rootKey, providerKey },
    public: {
      fileMode: mode.toString(8).padStart(4, "0"),
      providerBaseUrl,
      modelId,
      protocol: "openai-completions",
    },
  };
}

export function modelCatalog(publicProvider, limits) {
  return {
    providers: {
      "pi67-agent-pilot": {
        name: "Pi-67 Agent Pilot",
        baseUrl: publicProvider.providerBaseUrl,
        api: publicProvider.protocol,
        models: [{
          id: publicProvider.modelId,
          name: publicProvider.modelId,
          input: ["text"],
          reasoning: false,
          contextWindow: 32768,
          maxTokens: limits.modelMaxOutputTokens,
        }],
      },
    },
  };
}

function normalizeHttpsBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The Agent pilot Provider base URL must be credential-free HTTPS.");
  }
  return value.replace(/\/+$/u, "");
}

function requiredString(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`External configuration is missing ${field}.`);
  return normalized;
}

function requiredIdentifier(value, field) {
  const normalized = requiredString(value, field);
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/iu.test(normalized)) {
    throw new Error(`External configuration field ${field} is not a safe model identifier.`);
  }
  return normalized;
}
