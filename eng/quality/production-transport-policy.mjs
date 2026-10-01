const nativeAdapter = "apps/desktop/src/openviking-native-process.mts";
// ADR 0003: the one Agent Host-owned outbound Team Chat push socket.
const teamChatRealtime = "apps/agent-host/src/team-chat/team-chat-realtime.ts";
// ADR 0002: the authenticated loopback OpenViking sidecar's default client endpoint.
const OPENVIKING_LOOPBACK_DEFAULT = "http://127.0.0.1:1933";
const openVikingDefaultConfig = new Set([
  "packages/domain/src/context-memory.ts",
  "packages/openviking-pi-extension/config.ts"
]);
const forbidden = [
  ["WebSocket API", /\bWebSocket\b/u],
  ["local HTTP server", /\bcreateServer\s*\(/u],
  ["listening socket", /\.listen\s*\(/u],
  ["WebSocket URL", /\bwss?:\/\//u]
];

export function productionTransportViolations(path, source) {
  const failures = [];
  let checked = source;
  if (path === nativeAdapter) {
    // ADR 0002 permits one immediately released OS-assigned loopback reservation,
    // not a server callback, fixed/public port, Renderer listener or second socket.
    checked = checked.replace("const reservation = createServer();", "const reservation = ownedPortReservation();")
      .replace('reservation.listen(0, "127.0.0.1",', "reserveLoopbackPort(");
    for (const required of ['from "node:net"', "reservation.close(",
      'root_api_key: "${NEWMONEY_OV_ROOT_KEY}"', '"X-API-Key": rootKey', "detached: true"]) {
      if (!source.includes(required)) failures.push(`${path} lacks its native sidecar invariant: ${required}`);
    }
    const events = source.replace('reservation.once("error", reject);', "");
    if (/reservation\.(?:on|once|addListener|prependListener|prependOnceListener)\s*\(/u.test(events)) {
      failures.push(`${path} attaches a reservation event handler`);
    }
  }
  if (path === teamChatRealtime) {
    // Exactly one client socket, upgraded from the HTTPS origin; never a server,
    // listener, Node socket library, or literal endpoint.
    if ((checked.match(/\bnew WebSocket\(/gu) ?? []).length !== 1) {
      failures.push(`${path} must construct exactly one client WebSocket`);
    }
    if (!checked.includes('if (url.protocol === "https:") url.protocol = "wss:";')) {
      failures.push(`${path} lacks its Team Chat invariant: HTTPS origins upgrade only to wss:`);
    }
    if (/WebSocketServer|from "(?:ws|node:net|node:http|node:https)"/u.test(checked)) {
      failures.push(`${path} imports or creates a socket server`);
    }
    checked = checked.replace(/\bWebSocket\b/gu, "PushSocket");
  }
  for (const [label, pattern] of forbidden) {
    if (pattern.test(checked)) failures.push(`${path} contains ${label}`);
  }
  for (const match of source.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[^"'`\s]*/gu)) {
    const vite = path === "apps/desktop/src/renderer-security.ts"
      && ["http://127.0.0.1:5173/", "http://127.0.0.1:5173"].includes(match[0]);
    const sidecar = path === nativeAdapter && match[0] === "http://127.0.0.1:${port}";
    const memorySidecar = openVikingDefaultConfig.has(path) && match[0] === OPENVIKING_LOOPBACK_DEFAULT;
    if (!vite && !sidecar && !memorySidecar) failures.push(`${path} contains localhost production URL`);
  }
  return failures;
}
