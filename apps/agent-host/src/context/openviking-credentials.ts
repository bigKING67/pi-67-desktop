import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface OpenVikingClientCredentials {
  source: "environment" | "ovcli" | "none";
  bearerToken?: string;
  account?: string;
  user?: string;
  problem?: string;
}

export function resolveOpenVikingClientCredentials(
  endpoint: string,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir()
): OpenVikingClientCredentials {
  const mode = credentialMode(environment);
  const environmentToken = text(environment.OPENVIKING_BEARER_TOKEN)
    || text(environment.OPENVIKING_API_KEY);
  const configuredPath = resolveConfigPath(
    environment.OPENVIKING_CLI_CONFIG_FILE,
    homeDirectory
  );
  const cliPath = configuredPath || join(homeDirectory, ".openviking", "ovcli.conf");
  const cli = readJsonObject(cliPath);
  const cliToken = text(cli.api_key);
  const explicitCli = mode === "cli";
  const useEnvironment = mode === "environment" || (mode === "auto" && Boolean(environmentToken));
  const cliEndpointMatches = !text(cli.url) || normalizeEndpoint(cli.url) === normalizeEndpoint(endpoint);
  const useCli = explicitCli || (mode === "auto" && !useEnvironment && Boolean(cliToken) && cliEndpointMatches);

  if (useEnvironment) {
    return {
      source: "environment",
      ...(environmentToken ? { bearerToken: environmentToken } : {
        problem: "OpenViking environment credential mode is enabled but no bearer token is configured."
      }),
      ...optionalIdentity(environment.OPENVIKING_ACCOUNT, environment.OPENVIKING_USER)
    };
  }
  if (useCli) {
    if (!cliEndpointMatches) {
      return {
        source: "ovcli",
        problem: "OpenViking ovcli.conf endpoint does not match the effective Desktop endpoint."
      };
    }
    return {
      source: "ovcli",
      ...(cliToken ? { bearerToken: cliToken } : {
        problem: "OpenViking ovcli.conf does not contain a user API key."
      }),
      ...optionalIdentity(
        text(cli.account) || text(cli.account_id),
        text(cli.user) || text(cli.user_id)
      )
    };
  }
  return { source: "none" };
}

function optionalIdentity(accountValue: unknown, userValue: unknown) {
  const account = text(accountValue);
  const user = text(userValue);
  return {
    ...(account ? { account } : {}),
    ...(user ? { user } : {})
  };
}

function credentialMode(environment: NodeJS.ProcessEnv): "auto" | "environment" | "cli" {
  const value = text(environment.OPENVIKING_CREDENTIAL_SOURCE)
    || text(environment.OPENVIKING_CREDENTIALS_SOURCE);
  if (["env", "environment"].includes(value.toLowerCase())) return "environment";
  if (["cli", "ovcli", "file", "config"].includes(value.toLowerCase())) return "cli";
  return "auto";
}

function resolveConfigPath(value: unknown, homeDirectory: string): string {
  const candidate = text(value);
  if (!candidate) return "";
  if (candidate === "~") return homeDirectory;
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    return resolve(homeDirectory, candidate.slice(2));
  }
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function normalizeEndpoint(value: unknown): string {
  try {
    const url = new URL(text(value));
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return text(value).replace(/\/+$/, "");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
