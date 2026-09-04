import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenVikingCredentials } from "./shared/credentials.mjs";

describe("OpenViking Pi credential boundary", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("never imports the server Root Key into the Pi Extension", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-ov-credentials-"));
    const serverConfig = join(root, "ov.conf");
    await writeFile(serverConfig, JSON.stringify({
      server: { root_api_key: "must-not-enter-pi", host: "127.0.0.1", port: 1933 },
    }));

    const resolved = resolveOpenVikingCredentials({
      OPENVIKING_CONFIG_FILE: serverConfig,
      OPENVIKING_CLI_CONFIG_FILE: join(root, "missing-ovcli.conf"),
    });
    expect(resolved.apiKey).toBe("");
    expect(resolved.hasApiKey).toBe(false);
  });

  it("uses one matching ovcli source when only the endpoint is overridden", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-ov-credentials-"));
    const cliConfig = join(root, "ovcli.conf");
    await writeFile(cliConfig, JSON.stringify({
      url: "http://127.0.0.1:1933/",
      api_key: "fixture-user-key",
      account: "account-a",
      user: "user-a",
      actor_peer_id: "peer-a",
    }));

    const resolved = resolveOpenVikingCredentials({
      OPENVIKING_URL: "http://127.0.0.1:1933",
      OPENVIKING_CLI_CONFIG_FILE: cliConfig,
      OPENVIKING_CONFIG_FILE: join(root, "missing-ov.conf"),
    });
    expect(resolved).toMatchObject({
      credentialSource: "ovcli",
      apiKey: "fixture-user-key",
      account: "account-a",
      user: "user-a",
      peerId: "peer-a",
    });
  });

  it("fails closed instead of sending ovcli credentials to a different endpoint", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-ov-credentials-"));
    const cliConfig = join(root, "ovcli.conf");
    await writeFile(cliConfig, JSON.stringify({
      url: "http://127.0.0.1:1933",
      api_key: "must-not-cross-endpoints",
      account: "account-a",
      user: "user-a",
    }));

    const resolved = resolveOpenVikingCredentials({
      OPENVIKING_URL: "https://other-openviking.example.test",
      OPENVIKING_CLI_CONFIG_FILE: cliConfig,
      OPENVIKING_CONFIG_FILE: join(root, "missing-ov.conf"),
    });
    expect(resolved).toMatchObject({
      credentialSource: "none",
      baseUrl: "https://other-openviking.example.test",
      apiKey: "",
      account: "",
      user: "",
      peerId: "",
      hasApiKey: false,
    });
  });

  it("does not backfill an environment credential source from ovcli", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-ov-credentials-"));
    const cliConfig = join(root, "ovcli.conf");
    await writeFile(cliConfig, JSON.stringify({
      url: "http://127.0.0.1:1933",
      api_key: "fixture-cli-key",
      account: "cli-account",
      user: "cli-user",
      actor_peer_id: "cli-peer",
    }));

    const resolved = resolveOpenVikingCredentials({
      OPENVIKING_URL: "http://127.0.0.1:1933",
      OPENVIKING_API_KEY: "fixture-env-key",
      OPENVIKING_ACCOUNT: "env-account",
      OPENVIKING_CLI_CONFIG_FILE: cliConfig,
      OPENVIKING_CONFIG_FILE: join(root, "missing-ov.conf"),
    });
    expect(resolved).toMatchObject({
      credentialSource: "env",
      apiKey: "fixture-env-key",
      account: "env-account",
      user: "",
      peerId: "",
    });
  });
});
