import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveApplicationAssetPath } from "./app-protocol-path.js";

describe("application protocol asset paths", () => {
  const rendererDirectory = join("root", "renderer");

  it("maps the application root and nested assets into the renderer directory", () => {
    expect(resolveApplicationAssetPath(rendererDirectory, "app://pi67/"))
      .toBe(join(rendererDirectory, "index.html"));
    expect(resolveApplicationAssetPath(rendererDirectory, "app://pi67/assets/app.js"))
      .toBe(join(rendererDirectory, "assets/app.js"));
  });

  it("rejects other hosts and encoded traversal outside the renderer directory", () => {
    expect(resolveApplicationAssetPath(rendererDirectory, "app://other/index.html")).toBeUndefined();
    expect(resolveApplicationAssetPath(rendererDirectory, "app://pi67/%2e%2e%2fsecret.txt")).toBeUndefined();
  });
});
