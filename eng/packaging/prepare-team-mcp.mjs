import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const defaultDestination = join(root, "apps/desktop/resources/team-mcp/tavily-bridge.token");
const defaultSource = join(homedir(), ".grok/secrets/tavily_bridge_mcp_token");

/**
 * Optional local helper: copy a client token into Desktop resources for dev experiments.
 *
 * Packaged releases no longer ship a team token. Users configure it in
 * Settings → 集成 → 团队搜索中转. Do not rely on this script for distribution.
 */
export async function prepareTeamMcpToken(options = {}) {
  const source = resolve(options.source ?? process.env.PI67_TEAM_MCP_TOKEN_SOURCE ?? defaultSource);
  const destination = resolve(options.destination ?? defaultDestination);
  await access(source);
  const raw = await readFile(source, "utf8");
  const token = raw.replace(/^\uFEFF/, "").trim();
  if (!token.startsWith("mcp_") || !token.includes(".")) {
    throw new Error("Team MCP token source has an invalid client-token format.");
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${token}\n`, { mode: 0o600 });
  return {
    source,
    destination,
    bytes: Buffer.byteLength(`${token}\n`),
    prefix: `${token.slice(0, 16)}...`
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareTeamMcpToken();
  console.log(`Prepared local team MCP token for development only (${result.prefix}, ${result.bytes} bytes).`);
  console.log("Packaged apps require each user to configure the token in Settings → 集成.");
}
