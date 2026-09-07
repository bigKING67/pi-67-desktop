import { isIP } from "node:net";
import { Agent, fetch } from "undici";

import type { PublicFetchResponse } from "./first-party-web-tool-contract.js";

/** One validated DNS snapshot and one owned dispatcher per redirect hop. */
export async function openPinnedPublicResponse(
  url: URL,
  addresses: readonly string[],
  signal?: AbortSignal
): Promise<PublicFetchResponse> {
  signal?.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const snapshot = addresses.map((address) => ({ address, family: isIP(address) }));
  if (!snapshot.length || snapshot.some(({ family }) => family === 0)) {
    throw new Error("FETCH_ADDRESS_INVALID: a validated IP snapshot is required.");
  }
  const agent = new Agent({
    connections: 1,
    connect: {
      autoSelectFamily: true,
      lookup(name, options, callback) {
        const candidates = snapshot.filter(({ family }) => !options.family || options.family === family);
        if (name !== hostname || !candidates.length) {
          callback(new Error("FETCH_ADDRESS_INVALID: connection does not match the validated snapshot."), []);
          return;
        }
        if (options.all) callback(null, candidates.map((entry) => ({ ...entry })));
        else callback(null, candidates[0]!.address, candidates[0]!.family);
      }
    }
  });
  try {
    const options = {
      method: "GET",
      headers: { accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.1" },
      redirect: "manual" as const,
      dispatcher: agent,
      ...(signal ? { signal } : {})
    };
    const response = await fetch(url, options);
    return { response, dispose: async () => { await agent.destroy(); } };
  } catch (error) {
    await agent.destroy();
    throw error;
  }
}
