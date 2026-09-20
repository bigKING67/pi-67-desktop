import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { productionTransportViolations } from "./production-transport-policy.mjs";

const path = "apps/desktop/src/openviking-native-process.mts";
const source = await readFile(resolve(import.meta.dirname, "../..", path), "utf8");

describe("approved native transport exception", () => {
  it("admits the actual authenticated sidecar reservation only at its Main-owned path", () => {
    expect(productionTransportViolations(path, source)).toEqual([]);
    expect(productionTransportViolations("apps/renderer/src/sidecar.mts", source).length).toBeGreaterThan(0);
  });
  it("rejects public/fixed ports, server callbacks and a second listener", () => {
    for (const modified of [source.replace('listen(0, "127.0.0.1",', 'listen(1933, "127.0.0.1",'),
      source.replace('listen(0, "127.0.0.1",', 'listen(0, "0.0.0.0",'),
      source.replace("createServer()", "createServer(handler)"),
      `${source}\nconst extra = createServer(); extra.listen(1933);`,
      `${source}\nreservation.on("connection", handler);`,
      `${source}\nreservation.once("connection", handler);`]) {
      expect(productionTransportViolations(path, modified).length).toBeGreaterThan(0);
    }
  });
  it("still rejects WebSockets and loss of authentication or containment", () => {
    for (const modified of [`${source}\nnew WebSocket("wss://example.test");`,
      source.replace('root_api_key: "${NEWMONEY_OV_ROOT_KEY}"', "root_api_key: null"),
      source.replace("detached: true", "detached: false")]) {
      expect(productionTransportViolations(path, modified).length).toBeGreaterThan(0);
    }
  });
});
