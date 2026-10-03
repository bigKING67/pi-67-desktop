# Pi 1.0 native MCP migration

Updated: 2026-10-03. Status: local migration complete; source, Renderer, native Electron and macOS
packaged acceptance passed. Exact counts and artifact identity are recorded in the execution plan.

## Decision and scope

Desktop migrates completely from `pi-mcp-adapter@2.11.0` to the public Pi 1.0.0
native MCP factory. The user explicitly accepted a minimal, exact-version pnpm
patch for missing host seams and the reproduced pending-connection shutdown bug.
The old adapter is removed from bundled dependencies, startup provisioning and
runtime package selection. Existing user settings, MCP files, caches and sessions
are preserved. There is no automatic adapter fallback or second transport/loop.

Native `tool_search` supplies deferred discovery previously provided by the `mcp`
proxy. Codemode, Pi Durable and virtual model routing remain outside this change.
All verification uses isolated synthetic profiles, processes and provider streams;
no paid model, real remote MCP or user browser operation is part of acceptance.

## Upstream evidence and bounded patch

The pinned upstream is `@earendil-works/pi-coding-agent@1.0.0`, release commit
`a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. The npm latest version was still 1.0.0
when checked on 2026-10-03. The patch lives in
[`patches/@earendil-works__pi-coding-agent@1.0.0.patch`](../../patches/@earendil-works__pi-coding-agent@1.0.0.patch);
`pnpm-workspace.yaml` and the frozen lockfile bind it to that exact package.
It changes shipped JS and matching declarations, preserving upstream defaults
for consumers that omit the host options. Desktop uses only the public entrypoint.

The patch supplies host control of raw logs, output persistence, OAuth login,
profile directory, live tool exposure and exact registration bindings. Desktop
turns logging/output persistence/OAuth loopback login off and admits file-configured
servers only. Pending clients are registered before initialize and closed/awaited
with established connections; late async connection creation cannot outlive shutdown.
The removed adapter's executor is not copied into the patch or Desktop.

Before updating Pi again, compare these changes against the new upstream source,
remove resolved hunks and run the same native regressions. A new version is not
implicitly covered by the 1.0.0 patch or acceptance evidence.

## Runtime contracts

| Boundary | Migrated behavior |
| --- | --- |
| Ownership | One Pi native MCP factory per normal Session; native transport, dynamic registration, cancellation and Tool Result projection remain Pi-owned. |
| Configuration | Agent profile `mcp.json` plus trusted Workspace `.pi/mcp.json`; project definitions override the same global name. Invalid overrides and ambiguous native namespaces fail closed. |
| Legacy fields | Translate `directTools`, `excludeTools`, `requestTimeoutMs`, bearer token/env fields in memory. Ordinary proxy-style tools become deferred; managed browser67 remains direct. Native explicit exposures are respected. |
| Unsupported sources | Legacy shared `~/.config/mcp/mcp.json`, project `.mcp.json`, imports and extension-registered servers are outside native Desktop admission. Move intended entries to Pi `mcpServers`; imports in a loaded file produce a diagnostic. No user file is rewritten by this loader. |
| Unsupported semantics | Legacy SSE, ambiguous auth, disabled legacy OAuth semantics and Codemode fail explicitly. Native streamable HTTP is supported by the SDK; real service/OAuth interoperability is not certified by synthetic stdio tests. |
| Identity | Bind the admitted configuration digest, raw tool name, final Pi name, exact normalized schema and factory source. Refresh/withdrawal/hidden tools invalidate prior grants; cache files and name prefixes do not grant permission. |
| Policy | AUTO capability grants use the exact binding and existing effect classifier. PLAN is read-only. AUTO and YOLO both retain exact destructive-action confirmation; MCP annotations cannot create grants. |
| Resources | Native list/read helpers use the same admitted server boundary, including an omitted server filter. `tool_search` replaces proxy discovery without enabling Codemode. |
| Privacy | No server log or automatic large/binary output file. Truncated/unsaved results say so. Credential storage is scoped to Desktop's explicit agent directory. Loopback OAuth login is refused. |
| Managed browser67 | Receipted, compare-and-swap provisioning changes directTools to native exposure. User conflicts and unknown fields remain intact; old MCP cache bytes are preserved and unused. |
| Packaging | Adapter managed-npm bundle/activation stage removed. Packaged native fixture must prove one actual tool call through the private Node, exact owner identity, no old proxy, and child-process cleanup. |

## Verification and historical findings

The first isolated prototype reproduced three adoption blockers: YOLO deletion
confirmation was lost through generic tool classification; upstream wrote raw logs
and large results by default; shutdown returned before pending initialize terminated.
Its nine passing characterization tests demonstrated these defects, not readiness.
The original evidence remains in `/tmp/pi67-native-mcp-prototype-final.log` and the
execution plan. This migration replaces those expectations with production regressions.

Current regressions drive real Pi sessions and stdio transports with deterministic
model streams. They cover schema/name collisions and refresh, invalid calls,
AUTO/PLAN/YOLO deletion policy, hidden legacy exclusions, deferred discovery,
large text/binary/resource privacy, cancellation and reuse, reload, and initializing
process-tree shutdown. A default-options sample separately confirms that the patch
does not change upstream persistence behavior for other hosts; its synthetic files
are tracked and removed by the fixture.

Independent review also reproduced an unadmitted registered-server resource-list
path and a three-way namespace collision. Those were fixed within the authorized migration and independently rechecked;
regressions now enforce both boundaries. Relative package
paths are included in retirement verification so an old adapter cannot be revived
merely by its package source spelling.

Authoritative final counts and fresh artifact identity are in
[`2026-10-03-pi-1-upgrade.md`](../plans/2026-10-03-pi-1-upgrade.md). Source checks,
Electron tests and packaged smoke are separate evidence layers. Windows, real
remote service/OAuth behavior, performance and user-profile manual acceptance
remain unverified unless that plan records an explicit result.

## Evidence map

- [Session factories](../../packages/pi-runtime/src/session-services.ts)
- [Read-only configuration migration](../../packages/pi-runtime/src/native-mcp-config.ts)
- [Exact capability catalog](../../packages/pi-runtime/src/native-mcp-catalog.ts)
- [Tool identity](../../packages/pi-runtime/src/tool-safety-profile.ts) and
  [effect policy](../../packages/pi-runtime/src/configured-tool-safety.ts)
- [Real SDK integration regressions](../../packages/pi-runtime/src/native-mcp.integration.test.ts)
- [Adapter runtime retirement](../../packages/pi-runtime/src/desktop-package-toolchain.ts)
- [Managed browser67 provisioning](../../apps/agent-host/src/managed-browser67-mcp-provision.ts)
- [Packaged native MCP smoke](../../eng/packaging/packaged-native-mcp-smoke.mjs)
- [Product authority](../../PRODUCT.md), [interaction authority](../../DESIGN.md),
  [SDK compatibility](./pi-sdk.md)

Primary upstream references:

- [Pi v1.0.0 SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)
- [Pi v1.0.0 MCP](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md)
- [pi-mcp v1.0.0](https://github.com/earendil-works/pi/blob/v1.0.0/packages/mcp/README.md)
