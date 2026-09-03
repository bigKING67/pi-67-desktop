# Upstream provenance

- Project: `volcengine/OpenViking`
- Source: `examples/pi-coding-agent-extension`
- Tag: `v0.4.16`
- Upstream repository license: AGPL-3.0
- Example/integration exception: the upstream project documents example and Pi
  integration code as Apache-2.0; retain upstream notices when redistributing.
- Imported: 2026-08-31

The imported lifecycle, client, recall, capture, pending queue, and takeover
files remain close to the tagged upstream example. Pi-67 Desktop-specific changes are
limited to private-by-default configuration, actor/workspace recall scope,
bounded experience quotas, stable one-shot startup Recall, session-aware
model-selected cheap-first search and tiered read Tools, local feedback,
privacy-safe bounded recall diagnostics, untrusted injection and Tool results,
memory-owner conflict detection, and privacy-mode write gating.

The repository structure gate therefore has narrow, file-specific line limits
for the three largest preserved upstream implementation files. The package is
not exempt as a whole; any new large file or growth beyond those explicit
limits still fails the gate and requires review.

OpenViking Server is not copied into or linked with this repository.

The first meaningful prompt in each OpenViking Session produces one stable
startup Recall snapshot. Later Turns never run adapter-owned task-shift
classification or mutate historical recall anchors. Pi instead receives a fixed
Tool policy: call `viking_search` once when a materially different task,
earlier-work reference, or missing history requires retrieval; use returned URI
abstracts first; then call `viking_read` for only a selected URI when deeper
detail is needed. The explicit search path first uses bounded actor-scoped
`/find`; only empty, weak, or ambiguous candidates upgrade to the current
`session_id` context face with query expansion. Startup Recall keeps expansion
off. Short positive and negative result caches are local to one Pi process and
are invalidated when recall feedback changes.

Startup Profile and Recall are bounded to 1,200-token baselines and default to
one private plus one shared Experience. Recall and OpenViking Tool results remain
untrusted user-level context and are never promoted into the System Prompt.
Session Profile and Archive Overview follow the same envelope and trust level;
only the static OpenViking Tool policy is appended to the System Prompt.

The standalone Extension can only self-disable when it detects a competing
owner; it cannot unload an Extension that Pi already imported. Global
Memory-fail-closed behavior therefore belongs to an owner-aware Host preload
gate (Pi-67 Desktop) or a conflict-free standalone Agent Directory.

## Desktop source migration

- Previous local source: `pi-67/extensions/pi67-openviking`
- Previous package identity: `pi67-openviking@0.1.0-pi67.7`
- Imported source tree SHA-256: `e980b02681c9abe5aa163bdcc5854bab5f1ee8c35e2e76d60b4a982aae34e3c9`
- Desktop source authority since: 2026-09-01

The legacy identity is retained only for exact, non-destructive adoption of
already installed bytes. New source, packaging, tests, updates, and provenance
are owned by the Pi-67 Desktop repository; the standalone pi-67 manager is not
a runtime or distribution dependency.
