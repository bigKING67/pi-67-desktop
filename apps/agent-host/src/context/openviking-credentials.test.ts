import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenVikingClientCredentials } from "./openviking-credentials.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveOpenVikingClientCredentials", () => {
  it("reads a user-scoped ovcli key outside the repository without a root-key fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-openviking-credentials-"));
    roots.push(root);
    const cliPath = join(root, "ovcli.conf");
    await writeFile(cliPath, JSON.stringify({
      url: "http://127.0.0.1:1933",
      api_key: "fixture-user-key",
      account: "account-a",
      user: "user-a"
    }), "utf8");

    expect(resolveOpenVikingClientCredentials("http://127.0.0.1:1933", {
      OPENVIKING_CREDENTIAL_SOURCE: "cli",
      OPENVIKING_CLI_CONFIG_FILE: cliPath
    }, root)).toEqual({
      source: "ovcli",
      bearerToken: "fixture-user-key",
      account: "account-a",
      user: "user-a"
    });
  });

  it("fails closed for an explicitly selected credential file bound to another endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-openviking-credentials-"));
    roots.push(root);
    const cliPath = join(root, "ovcli.conf");
    await writeFile(cliPath, JSON.stringify({
      url: "https://other.example.test",
      api_key: "fixture-user-key"
    }), "utf8");

    expect(resolveOpenVikingClientCredentials("https://context.example.test", {
      OPENVIKING_CREDENTIAL_SOURCE: "cli",
      OPENVIKING_CLI_CONFIG_FILE: cliPath
    }, root)).toMatchObject({
      source: "ovcli",
      problem: expect.stringContaining("does not match")
    });
  });

  it("uses an explicit environment bearer token without consulting a client file", () => {
    expect(resolveOpenVikingClientCredentials("https://context.example.test", {
      OPENVIKING_CREDENTIAL_SOURCE: "env",
      OPENVIKING_BEARER_TOKEN: "fixture-environment-token",
      OPENVIKING_ACCOUNT: "account-a",
      OPENVIKING_USER: "user-a"
    }, "/nonexistent-home")).toEqual({
      source: "environment",
      bearerToken: "fixture-environment-token",
      account: "account-a",
      user: "user-a"
    });
  });
});
