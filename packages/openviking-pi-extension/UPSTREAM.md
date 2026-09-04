# Upstream provenance

- Project: `volcengine/OpenViking`
- Source: `examples/pi-coding-agent-extension`
- Tag: `v0.4.16`
- Commit: `499995f3ed2e7f551a715179c4053772c51ff819`
- Upstream repository license: AGPL-3.0
- Example/integration exception: the upstream project documents example and Pi
  integration code as Apache-2.0; retain upstream notices when redistributing.
- Imported: 2026-08-31

The imported lifecycle, client, recall, capture, pending queue, and takeover
files remain close to the tagged upstream example. Recall follows the upstream
current-prompt lifecycle and server-assembled context algorithm. Pi-67
Desktop-specific changes are limited to private-by-default configuration,
actor/workspace recall scope, bounded experience quotas, tiered read bounds,
local feedback, privacy-safe bounded recall diagnostics, untrusted injection
and Tool results, memory-owner conflict detection, and privacy-mode write
gating.

Desktop `0.2.0-desktop.6` additionally keeps every private Tool inside the
current user/current peer Memory trees, removes direct Resource ingestion from
the local adapter, bounds and escapes current-Session Archive expansion, and
selects credentials as one endpoint-matched source rather than mixing
environment, `ovcli.conf`, and server configuration fields.

Actor-scoped Recall is fail-closed across server versions. If a legacy server
rejects `peer_scope`, the adapter skips Recall for that prompt; it never removes
the scope field, retries more broadly, or falls through to a wider raw search.

The repository structure gate therefore has narrow, file-specific line limits
for the three largest preserved upstream implementation files. The package is
not exempt as a whole; any new large file or growth beyond those explicit
limits still fails the gate and requires review.

OpenViking Server is not copied into or linked with this repository.

Every Prompt queues the current query before Pi's provider request; matching the
upstream Extension, prompts below `minQueryLength` clear stale Recall and skip the
network request.
The `context` hook synchronously asks OpenViking's context search face for a
fresh server-assembled block using the current `session_id`, automatic query
expansion, and five-turn cross-turn dedup. The block is injected at the latest
user message and reused only for Tool continuations within the same Pi agent
run. Task switches therefore require no classifier, manual refresh, or extra
model-selected search round trip.

Pi keeps the official on-demand Tool shape. `viking_search` makes one bounded
`/find` request and is reserved for an absent or insufficient inline Recall,
an explicit user history-search request, or discovery of a still-missing prior
decision. `viking_read` deepens only a selected URI. Pi-67 adds strict actor and
URI scope, user-feedback filtering, untrusted result envelopes, and bounded
diagnostics after the official retrieval result; it does not add a second
cheap-first/expansion router or a hidden result cache.

Session Profile and each current-prompt Recall are bounded to 1,200-token
baselines and default to one private plus one shared Experience. Recall and
OpenViking Tool results remain untrusted user-level context and are never
promoted into the System Prompt.
Session Profile and Archive Overview follow the same envelope and trust level;
only the static OpenViking Tool policy is appended to the System Prompt.

The standalone Extension can only self-disable when it detects a competing
owner; it cannot unload an Extension that Pi already imported. Global
Memory-fail-closed behavior therefore belongs to an owner-aware Host preload
gate (Pi-67 Desktop) or a conflict-free standalone Agent Directory.

Capture uses deterministic `source_message_ids`, persisted semantic prefix
state, and a separate OpenViking Session lineage after Branch/Fork/Rewind.
Create and append operations enter the durable outbox before transport; replay
checks the remote Session/message identity before sending and never treats a
dropped queue file as delivery. OpenViking server auto-commit is disabled so
the adapter can persist the accepted source watermark before an explicit
commit. Recall requests have AbortSignal plus generation/Session fences, and
one client-owned connection state lets automatic Recall/Capture resume after a
temporary outage without restarting Pi.

## Desktop source migration

- Previous local source: `pi-67/extensions/pi67-openviking`
- Previous package identity: `pi67-openviking@0.1.0-pi67.7`
- Imported source tree SHA-256: `e980b02681c9abe5aa163bdcc5854bab5f1ee8c35e2e76d60b4a982aae34e3c9`
- Desktop source authority since: 2026-09-01

The legacy identity is retained only for exact, non-destructive adoption of
already installed bytes. New source, packaging, tests, updates, and provenance
are owned by the Pi-67 Desktop repository; the standalone pi-67 manager is not
a runtime or distribution dependency.
