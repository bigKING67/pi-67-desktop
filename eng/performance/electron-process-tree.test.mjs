import { describe, expect, it } from "vitest";
import {
  parseMacProcessList,
  parseWindowsProcessList,
  selectProcessTree
} from "./electron-process-tree.mjs";

describe("Electron process tree evidence", () => {
  it("parses macOS process rows and converts RSS KiB to bytes", () => {
    expect(parseMacProcessList(`
100 1 200 Pi-67 Desktop
101 100 300 Pi-67 Desktop Helper --type=renderer
invalid row
`)).toEqual([
      { pid: 100, parentPid: 1, rssBytes: 204_800, command: "Pi-67 Desktop" },
      { pid: 101, parentPid: 100, rssBytes: 307_200, command: "Pi-67 Desktop Helper --type=renderer" }
    ]);
  });

  it("parses both singular and array-shaped Windows process output", () => {
    expect(parseWindowsProcessList(JSON.stringify({
      ProcessId: 100,
      ParentProcessId: 1,
      WorkingSetSize: 200,
      PrivatePageCount: 150,
      CommandLine: null
    }))).toEqual([{
      pid: 100,
      parentPid: 1,
      rssBytes: 200,
      privateBytes: 150,
      command: ""
    }]);
  });

  it("selects only transitive descendants of the Electron root", () => {
    const rows = [
      { pid: 100, parentPid: 1 },
      { pid: 101, parentPid: 100 },
      { pid: 102, parentPid: 101 },
      { pid: 200, parentPid: 1 }
    ];
    expect(selectProcessTree(rows, 100)).toEqual(rows.slice(0, 3));
  });
});
