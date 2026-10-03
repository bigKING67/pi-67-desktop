import type { McpServerEntry, ToolInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { NativeMcpCatalog, NATIVE_MCP_EXTENSION_PATH } from "./native-mcp-catalog.js";

const entry: McpServerEntry = { name: "synthetic", source: "/isolated/mcp.json", scope: "global", config: { command: "synthetic" } };
function tool(): ToolInfo {
  return { name: "mcp__synthetic__write", description: "Synthetic", parameters: { type: "object", properties: {} },
    exposure: "direct", sourceInfo: { source: "inline", path: NATIVE_MCP_EXTENSION_PATH, scope: "temporary", origin: "top-level" } } as ToolInfo;
}

describe("native MCP admitted identity", () => {
  it("binds only SDK callbacks for the exact admitted config and current normalized schema", () => {
    const catalog = new NativeMcpCatalog();
    const info = tool();
    const binding = { name: info.name, toolName: "write", parameters: info.parameters, exposure: info.exposure };
    catalog.replaceTools(entry, [binding]);
    expect(catalog.resolve(info)).toBeUndefined();
    catalog.configure([entry]);
    catalog.replaceTools(entry, [binding]);
    expect(catalog.resolve(info)).toMatchObject({ serverName: "synthetic", toolName: "write" });
    expect(catalog.resolve({ ...info, parameters: { ...info.parameters } })).toBeUndefined();
    expect(catalog.resolve({ ...info, sourceInfo: { ...info.sourceInfo, path: "/forged/extension.ts" } })).toBeUndefined();
    catalog.replaceTools({ ...entry, config: { command: "changed" } }, [binding]);
    expect(catalog.resolve(info)).toBeUndefined();
  });

  it("invalidates duplicate, hidden, withdrawn and shutdown bindings", () => {
    const catalog = new NativeMcpCatalog();
    const info = tool();
    const binding = { name: info.name, toolName: "write", parameters: info.parameters, exposure: info.exposure };
    catalog.configure([entry]);
    for (const entries of [[binding, binding], [{ ...binding, exposure: "hidden" }], []]) {
      catalog.replaceTools(entry, [binding]);
      expect(catalog.resolve(info)).toBeDefined();
      catalog.replaceTools(entry, entries);
      expect(catalog.resolve(info)).toBeUndefined();
    }
    catalog.replaceTools(entry, [binding]);
    catalog.clear();
    expect(catalog.resolve(info)).toBeUndefined();
  });
});
