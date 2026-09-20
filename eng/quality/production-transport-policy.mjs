const nativeAdapter = "apps/desktop/src/openviking-native-process.mts";
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
  for (const [label, pattern] of forbidden) {
    if (pattern.test(checked)) failures.push(`${path} contains ${label}`);
  }
  for (const match of source.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[^"'`\s]*/gu)) {
    const vite = path === "apps/desktop/src/renderer-security.ts"
      && ["http://127.0.0.1:5173/", "http://127.0.0.1:5173"].includes(match[0]);
    const sidecar = path === nativeAdapter && match[0] === "http://127.0.0.1:${port}";
    if (!vite && !sidecar) failures.push(`${path} contains localhost production URL`);
  }
  return failures;
}
