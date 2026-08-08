import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import {
  type FetchDependencies,
  MAX_FETCH_URLS,
  MAX_RESULT_CHARS,
  asRecord,
  optionalString,
  readBoundedResponseBytes,
  stringArray
} from "./first-party-web-tool-contract.js";

export const DEFAULT_FETCH_DEPENDENCIES: FetchDependencies = {
  fetch: globalThis.fetch,
  async resolveAddresses(hostname) {
    if (isIP(hostname)) return [hostname];
    return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  }
};

export async function fetchPublicText(
  rawUrl: string,
  dependencies: FetchDependencies,
  signal?: AbortSignal
): Promise<{ url: string; text: string }> {
  let current = validatePublicHttpUrl(rawUrl);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicHostname(current.hostname, (hostname) => dependencies.resolveAddresses(hostname));
    const response = await dependencies.fetch(current, {
      method: "GET",
      headers: { accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.1" },
      redirect: "manual",
      ...(signal ? { signal } : {})
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) {
        throw new Error("FETCH_REDIRECT_REJECTED: redirect chain is incomplete or too long.");
      }
      current = validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`FETCH_CONTENT_FAILED: ${current.origin} returned HTTP ${response.status}.`);
    const bytes = await readBoundedResponseBytes(
      response,
      "FETCH_CONTENT_TOO_LARGE: response exceeds the 2 MiB extraction limit."
    );
    const decoded = new TextDecoder().decode(bytes);
    const type = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
    const text = type.includes("html") ? htmlToText(decoded) : decoded;
    return { url: current.toString(), text: text.slice(0, MAX_RESULT_CHARS) };
  }
  throw new Error("FETCH_REDIRECT_REJECTED: redirect chain is too long.");
}

export function normalizeUrls(input: unknown): string[] {
  const record = asRecord(input);
  const urls = stringArray(record.urls, MAX_FETCH_URLS);
  const single = optionalString(record.url);
  const normalized = [...(single ? [single] : []), ...urls].slice(0, MAX_FETCH_URLS);
  if (normalized.length === 0) throw new Error("FETCH_CONTENT_URL_REQUIRED: provide url or urls.");
  return [...new Set(normalized)];
}

function validatePublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("FETCH_URL_INVALID: expected an absolute HTTP(S) URL.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("FETCH_URL_REJECTED: only credential-free HTTP(S) URLs are allowed.");
  }
  return url;
}

async function assertPublicHostname(
  hostname: string,
  resolveAddresses: FetchDependencies["resolveAddresses"]
): Promise<void> {
  const normalizedHostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const addresses = await resolveAddresses(normalizedHostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("FETCH_SSRF_REJECTED: destination resolves to a local, private, reserved, or link-local address.");
  }
}

const NON_PUBLIC_ADDRESSES = createNonPublicAddressBlockLists();

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase("en-US").replace(/^\[|\]$/gu, "");
  const family = isIP(normalized);
  if (family === 4) return NON_PUBLIC_ADDRESSES.ipv4.check(normalized, "ipv4");
  if (family === 6) return NON_PUBLIC_ADDRESSES.ipv6.check(normalized, "ipv6");
  return true;
}

function createNonPublicAddressBlockLists(): { ipv4: BlockList; ipv6: BlockList } {
  const ipv4 = new BlockList();
  const ipv6 = new BlockList();
  const ipv4Ranges: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
    ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4]
  ];
  const ipv6Ranges: Array<[string, number]> = [
    ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
    ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
    ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
  ];
  for (const [network, prefix] of ipv4Ranges) ipv4.addSubnet(network, prefix, "ipv4");
  for (const [network, prefix] of ipv6Ranges) ipv6.addSubnet(network, prefix, "ipv6");
  return { ipv4, ipv6 };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/[\t ]+/gu, " ")
    .replace(/\n\s*\n\s*\n+/gu, "\n\n")
    .trim();
}
