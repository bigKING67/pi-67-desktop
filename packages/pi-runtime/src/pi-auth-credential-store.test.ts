import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authContentRevision,
  PiAuthContentChangedError,
  PiAuthCredentialStore
} from "./pi-auth-credential-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiAuthCredentialStore", () => {
  it("writes new auth.json files privately and requires the expected content revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-auth-store-"));
    temporaryDirectories.push(root);
    const path = join(root, "agent", "auth.json");
    const store = new PiAuthCredentialStore(path);

    const mutation = await store.replaceExpected(
      "custom",
      { type: "api_key", key: "fixture-api-key" },
      authContentRevision(undefined)
    );
    expect(mutation.previousContent).toBeUndefined();
    expect(JSON.parse(mutation.writtenContent)).toEqual({
      custom: { type: "api_key", key: "fixture-api-key" }
    });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);

    await expect(store.replaceExpected(
      "custom",
      { type: "api_key", key: "stale-write" },
      authContentRevision(undefined)
    )).rejects.toBeInstanceOf(PiAuthContentChangedError);
    expect(await readFile(path, "utf8")).toBe(mutation.writtenContent);
  });

  it("preserves an existing file mode and never overwrites a newer external edit", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-auth-mode-"));
    temporaryDirectories.push(root);
    const path = join(root, "auth.json");
    const initial = `${JSON.stringify({ first: { type: "api_key", key: "first-key" } }, null, 2)}\n`;
    await writeFile(path, initial, "utf8");
    if (process.platform !== "win32") await chmod(path, 0o640);
    const store = new PiAuthCredentialStore(path);

    const saved = await store.replaceExpected(
      "second",
      { type: "api_key", key: "second-key" },
      authContentRevision(initial)
    );
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o640);

    const external = `${JSON.stringify({ external: { type: "api_key", key: "external-key" } }, null, 2)}\n`;
    await writeFile(path, external, "utf8");
    await expect(store.deleteExpected("second", authContentRevision(saved.writtenContent)))
      .rejects.toBeInstanceOf(PiAuthContentChangedError);
    expect(await readFile(path, "utf8")).toBe(external);
  });

  it("resolves literal and environment-backed API keys through the Pi credential seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-auth-resolution-"));
    temporaryDirectories.push(root);
    const path = join(root, "auth.json");
    await writeFile(path, JSON.stringify({
      literal: { type: "api_key", key: "literal-key" },
      environment: {
        type: "api_key",
        key: "$PI67_TEST_API_KEY",
        env: { PI67_TEST_API_KEY: "environment-key" }
      },
      unavailable: { type: "api_key", key: "$PI67_MISSING_API_KEY" }
    }), "utf8");
    const store = new PiAuthCredentialStore(path);
    expect(await store.reload()).toBeUndefined();

    await expect(store.read("literal")).resolves.toMatchObject({ key: "literal-key" });
    await expect(store.read("environment")).resolves.toMatchObject({ key: "environment-key" });
    await expect(store.read("unavailable")).resolves.toEqual({ type: "api_key" });
    expect(await store.list()).toEqual([
      { providerId: "literal", type: "api_key" },
      { providerId: "environment", type: "api_key" },
      { providerId: "unavailable", type: "api_key" }
    ]);
  });
});
