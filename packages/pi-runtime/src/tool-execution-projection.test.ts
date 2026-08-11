import { describe, expect, it } from "vitest";
import {
  projectToolFailure,
  projectToolInput,
  projectToolProgress,
  safeToolCallId,
  safeToolName
} from "./tool-execution-projection.js";

describe("tool execution projection", () => {
  it("projects command metadata while redacting sensitive input", () => {
    const projection = projectToolInput("bash", {
      command: "curl -H 'Authorization: Bearer secret-value' https://example.test",
      token: "private-token",
      nested: { apiKey: "private-key" }
    }, "D:/code/pi-67-desktop");

    expect(projection.command?.text).toContain("[redacted]");
    expect(projection.command?.text).not.toContain("secret-value");
    expect(projection.inputSummary?.text).toContain("[redacted]");
    expect(projection.inputSummary?.text).not.toContain("private-token");
    expect(projection.cwd).toBe("D:/code/pi-67-desktop");
  });

  it("does not infer a command from an unknown Extension Tool", () => {
    const projection = projectToolInput("extension.custom", { command: "dangerous --flag" }, "/workspace");

    expect(projection.command).toBeUndefined();
    expect(projection.inputSummary?.text).toContain("dangerous --flag");
  });

  it("keeps a bounded tail for live progress and a bounded real failure", () => {
    const progress = projectToolProgress({ content: [{ text: `prefix-${"x".repeat(6_000)}-tail` }] });
    const failure = projectToolFailure({ error: { message: "provider unavailable" } }, "runtime-event");

    expect(progress?.text.length).toBeLessThanOrEqual(4_096);
    expect(progress?.text.endsWith("-tail")).toBe(true);
    expect(progress?.truncated).toBe(true);
    expect(failure).toMatchObject({
      detailState: "available",
      source: "runtime-event",
      message: { text: "provider unavailable", truncated: false }
    });
  });

  it("reports missing failure detail without inventing an error", () => {
    expect(projectToolFailure({}, "pi-result")).toEqual({
      detailState: "missing",
      source: "pi-result"
    });
  });

  it("bounds or hashes unsafe identities", () => {
    expect(safeToolName("bad\u0000name")).toBe("unknown-tool");
    expect(safeToolCallId(`call-${"x".repeat(1_000)}`)).toMatch(/^tool-call:[0-9a-f]{64}$/u);
  });
});
