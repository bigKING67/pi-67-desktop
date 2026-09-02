# OpenViking unified Context, Memory, and Experience vertical slice

Status: local source, macOS packaged product, and real local enterprise E2E complete; Windows and production acceptance pending
Owner: Codex
Started: 2026-08-31
Last updated: 2026-09-02

## Goal

Implement the first production-shaped vertical slice of the accepted OpenViking
architecture across Pi TUI, Pi-67 Desktop, and DataHub: a private local
Context/Memory owner that works without login, an additive enterprise identity
and shared-experience path after login, explicit privacy and owner policy, and
an Agent governance surface in DataHub. The former standalone `pi-67` control
plane is not a target runtime; its relevant Extension assets and verified
migration behavior are absorbed into Desktop-owned Pi capability distribution.

## Non-goals

- Do not replace Pi, add a second prompt composer, agent loop, Tool orchestrator,
  model router, or Session source of truth.
- Do not move raw Pi JSONL, prompts, Tool payloads, credentials, or private user
  memories into the enterprise service.
- Do not auto-publish any private experience or memory to a team library.
- Do not silently switch Context owners within an existing Session.
- Do not delete legacy memory data or user-modified Extension directories.
- Do not deploy to the DataHub VPS, publish packages, build release candidates,
  commit, push, tag, or release in this implementation boundary.

## Acceptance criteria

- Desktop-owned Pi capability distribution contains one pinned
  `pi67-openviking` Extension source with validated effective configuration,
  private defaults, failure diagnostics, and explicit conflict policy.
- Desktop Protocol v4 exposes typed context, memory, experience, and enterprise
  identity commands/events without creating a renderer-to-OpenViking channel.
- The Agent Host owns OpenViking control/diagnostics and preserves Pi fail-open,
  Memory fail-closed behavior; automatic recall/capture remains a Pi Extension
  responsibility.
- Desktop exposes Context & Memory status, privacy controls, effective config,
  recall inspection, and enterprise-link state through the existing bridge.
- DataHub exposes authenticated Agent governance APIs and an `Agent` navigation
  entry after Sample Inventory, with project binding, candidate review, shared
  assets, runtime status, and audit-oriented state.
- Enterprise storage accepts only redacted candidate payloads with pseudonymous
  source references and evidence hashes; publishing is an explicit review action.
- Focused schema, policy, route, component, backend, and cross-process tests pass.

## Delivery boundary

- Local implementation: authorized in Desktop and DataHub; bounded legacy
  `pi-67` migration work already completed is evidence, not an active runtime.
- Commit: not authorized.
- Push: not authorized.
- Candidate build/upload: not authorized.
- VPS/database deployment: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Desktop remains at `be2e39c6201ce1b131955cb57eb7e5c0e66c5b83`, aligned with `origin/main`, with the combined OpenViking and standalone-`pi-67` retirement WIP still uncommitted; Protocol version is v4. | live Git and source | 2026-09-02 |
| SUPERSEDED | The former standalone `pi-67` repository supplied validated migration, Doctor, and Extension-distribution behavior, but is no longer an active product runtime or ownership boundary. | accepted product boundary and current Desktop architecture | 2026-09-02 |
| OBSERVED | DataHub remains at `438e10d019ac13cf3fc029e479eee8a5928e31b9`; its local tracking ref is two commits ahead of the checkout, and unrelated DataOps/WeChat/package WIP overlaps shared manifests. The Agent Trellis task remains `in_progress`. | live Git and Trellis context; no fetch performed | 2026-09-02 |
| VERIFIED | Pi JSONL remains the Session truth; Desktop index remains disposable. | repository AGENTS and architecture contracts | 2026-08-31 |
| VERIFIED | DataHub already has JWT/RBAC and an existing Rust API plus Vite renderer; Agent belongs inside those boundaries. | live source inspection | 2026-08-31 |
| VERIFIED | OpenViking v0.4.16 is the selected loopback Lab baseline and remains healthy on OrbStack; production remains gated by pinned-image, TLS, tenant, storage, and compatibility acceptance. | live Lab health plus accepted architecture decision | 2026-09-02 |
| VERIFIED | The authenticated DataHub/OpenViking Shared Experience path publishes, allowlist-searches, deep-reads, revokes, deletes, audits, and returns zero after revocation with disposable enterprise infrastructure. | real local DataHub/OpenViking v0.4.16 E2E | 2026-09-02 |
| VERIFIED | DataHub renders authenticated `not_configured`, `unavailable`, and `degraded` runtime states with exact DOM/network state and three current browser67 PNG receipts. | disposable DataHub fixture and browser67 Agent Window | 2026-09-02 |
| VERIFIED | The macOS arm64 packaged Desktop isolates Agent Directory/Profile/Workspace/OpenViking identity and falls back to Pi's native threshold Compaction when OpenViking returns no successful response, then continues and resumes the same Session. | packaged isolation and compaction-fallback receipts | 2026-09-02 |

Evidence artifacts retained outside the product/runtime truth boundary:

- Packaged context isolation receipt:
  `artifacts/evidence/packaged-context-isolation/37fa20d1-188b-4efe-ac61-6f1514fd355c/receipt.json`
  (`fc366a33404d55f0a30c3936b0ee2684a9b0d06b7abbb510c0ad162345a503d4`).
- Packaged native Compaction fallback receipt:
  `artifacts/evidence/packaged-compaction-fallback/95aad87d-0b3b-4daa-a07d-43bb10887100/receipt.json`
  (`773f8bac89ef6d3817edad3b7479b50eac2ae1a6cc2f8042ad8b4343d2338903`).
- DataHub runtime-state fixture receipt:
  `/Users/gaoqian/Documents/sixseven/workman/groland/datahub/.artifacts/evidence/agent-runtime-ui-matrix/1771368d-018f-44dd-b3f2-72dc2ff6d166/fixture-receipt.json`
  (`8a20eb51332dc679b1cff9d36a6826b14e6ccd776698b024167dc97941a4a099`).
- Browser67 runtime-state screenshots are stored under
  `/Users/gaoqian/.browser67/runtime/runs/datahub-agent-runtime-ui-1771368d/`;
  their exact SHA-256 values are `ef35f0a749ca0fd7cc5d658f15f148894d69657497f70a28486c7de6c4865ddc`,
  `35ec85c9b27c2ebf71ff2ff92768c5eb59bbed087997b7aaecada4ece1b54ff1`,
  and `cf77f405168c416401465201207cedc28dbce35f016a9352f70ebabbf4546b2f`.

## Affected boundaries

- Modules/processes: legacy `pi-67` capability migration and retirement; Desktop
  domain, Protocol, Pi runtime, Agent Host, Main/Preload, capability distribution,
  and renderer; DataHub Rust API, migrations, auth/RBAC, route registry,
  navigation, and Agent page.
- Protocol or persisted state: Protocol v4 additions; Desktop secure context
  preferences; DataHub forward-only Agent governance tables; no Pi JSONL rewrite.
- Platform/artifact: source, real local services, and unsigned packaged macOS
  arm64 evidence are complete; Windows x64 and production deployment remain
  separate release gates.
- Security/privacy: untrusted context injection, local BYOK secrets in OS-backed
  storage, enterprise pseudonymous identifiers, candidate redaction, explicit
  publish/revoke audit, and no root/admin credentials in Desktop.
- Existing WIP: preserve every unrelated Desktop change and all pre-existing
  DataHub DataOps, WeChat downloader, README/CHANGELOG, and package manifest
  changes; do not normalize the two-commit DataHub baseline gap in this task.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Local private OpenViking remains available before and after login; enterprise recall is additive. | Login must not turn a private memory engine into a server-owned identity or break offline use. | Product intentionally adopts centrally managed memory-only mode with explicit migration and consent. |
| A Session locks one Context owner at creation. | Prevents double compaction, duplicate capture, and non-reproducible mid-session semantics. | Pi provides a first-class atomic owner-transfer contract with complete provenance. |
| Desktop resolves Memory owners before Pi imports Extensions. Retired OM/Hy runtimes are always excluded; exactly one OpenViking owner may load; duplicate OpenViking owners filter every Memory Package/local/managed owner path while preserving non-Memory Extensions and Pi default Compaction. | An Extension that detects a peer after import can stop only itself and cannot provide global fail-closed behavior. Treating retired runtimes as equal competitors would also disable the intended OpenViking owner unnecessarily. | Upstream Pi provides an equivalent authoritative owner slot, retirement list, and pre-import conflict contract. |
| `pi67-openviking` is the only supported third-party Context/Memory runtime. `pi-observational-memory` and `pi-hy-memory` remain only as legacy detection, migration, backup, and rollback identifiers. | Multiple production memory engines create duplicate recall/capture/compaction semantics and long-term maintenance cost. Existing user data must still remain recoverable. | A future engine replacement is approved with an explicit migration and one-owner cutover plan. |
| Standalone `pi67-openviking` reports `extension-self-disable`; it never claims to have unloaded OM/Hy-Memory. The standalone `pi-67` control plane is retired from the product architecture. | A standalone Extension has no authority over already imported peers, and maintaining another product control plane would duplicate Desktop ownership. | A future separately approved host adopts the same owner-aware preload contract and proves an independent product need. |
| Default privacy mode is `private-learning`; `full-learning` may create review candidates only for trusted enterprise-bound projects. | Preserves useful private learning while keeping enterprise publication reviewable. | Organization policy explicitly requires stricter no-write defaults. |
| Startup Recall is bounded to one private and one shared Experience within a 1,200-token Recall budget; Session Profile has a separate 1,200-token ceiling. | Limits stale experience dominance, protects prompt-cache stability, and leaves later detail retrieval demand-driven. | A/B evidence supports a safer budget change. |
| Each OpenViking Session receives one stable startup Recall snapshot. Later task changes are handled by Pi's normal model-selected `viking_search` Tool call, followed by `viking_read` only for a selected URI; the Extension does not run a second task classifier and exposes no refresh workflow. | Users should not manage memory refresh manually, while Pi remains the sole agent-loop and Tool-selection authority. Explicit search can use the current `session_id` and query expansion without charging every Turn or rewriting historical Prompt prefixes. | Real latency, cache-hit, token, retrieval-quality, or A/B evidence supports a bounded policy change. |
| DataHub stores governance metadata; OpenViking stores shared resource content/vector state. | Keeps audit/RBAC transactional while avoiding a second vector/memory implementation. | OpenViking adopts the required enterprise review ledger and relational governance contracts. |
| Private Agent Evolution is enabled for personal Case/Trajectory/Experience extraction; automatic enterprise publication remains disabled, and only reviewed assets become shared. | Personal experience extraction is required for local value, while organizational mutation must remain evidence-backed, redacted, reviewable, and reversible. | Review/audit metrics justify an explicitly governed auto-promotion policy. |

## Checkpoints

- [x] 1. Establish pinned `pi67-openviking` source, private config schema,
  effective-config Doctor, conflict policy, and focused migration/distribution
  tests; absorb the maintained capability into Desktop ownership and retire the
  standalone `pi-67` control plane.
- [x] 2. Add dependency-free Desktop context policy/state and Protocol v4
  command/event schemas with cross-process contract tests.
- [x] 3. Add Agent Host controller/client/outbox boundaries and bridge the
  status/config/recall/candidate operations without duplicating Pi hooks.
- [x] 4. Add Desktop Context & Memory settings and inspector surfaces with
  privacy, owner, health, recall, and enterprise-link states.
- [x] 5. Add DataHub Full Trellis specification, forward migration, Agent domain
  API, project/candidate/shared-asset governance, and audit/RBAC tests.
- [x] 6. Add DataHub `Agent` navigation/route/page and verify responsive,
  permission, empty, degraded, and populated states. Source, route protection,
  component tests, typecheck, lint, production build, authenticated navigation,
  healthy product flow, and authenticated `not_configured`/`unavailable`/
  `degraded` browser67 visual states pass.
- [x] 7. Run focused and aggregate gates, review final diffs/status, and record
  packaged, target-OS, VPS, and production boundaries. Desktop source and current
  macOS arm64 packaged product evidence pass. DataHub functional Rust, migration,
  frontend, authenticated UI, and real OpenViking gates pass; delivery remains
  uncommitted, its checkout remains two commits behind the local tracking ref,
  and no Windows, VPS, or production conclusion is inferred.
- [x] 8. Enforce the unique Memory-owner policy at the Desktop ResourceLoader
  boundary. Retired OM/Hy owners are excluded without blocking the sole
  OpenViking owner; duplicate OpenViking owners disable only third-party Memory
  for new Sessions. Normal Extensions and Pi default Compaction remain available,
  diagnostics distinguish installed/retired/eligible/loaded owners, and standalone
  Extension self-disable semantics remain explicit.
- [x] 9. Remove observational-memory from the Desktop-managed bundle, default
  enablement, package onboarding copy, packaging requirements, and the legacy
  active catalog. Preserve only bounded legacy recognition, selective migration,
  safe retirement, historical changelog, and regression fixtures.
- [x] 10. Introduce a stable one-shot Session startup Recall and move Session Profile and
  Archive Overview out of the System Prompt into the same untrusted user-level
  memory envelope.
- [x] 11. Remove the experimental per-prompt Recall Epoch classifier. Pi now
  receives a fixed Tool policy and automatically calls session-aware
  `viking_search` when a materially different task, earlier-work reference, or
  missing history requires it. Search returns bounded URI abstracts with query
  expansion on the explicit Tool path; `viking_read` performs bounded
  abstract/overview/full deep reads for a selected URI. No user refresh action is
  required or exposed.
- [x] 12. Add the Desktop enterprise identity transport without weakening local
  anonymous use. Electron Main encrypts the short-lived DataHub credential with
  OS secure storage and never projects the token to Renderer. Agent Host becomes
  ready and hands its Port to Renderer before enterprise credential restoration;
  the credential is then bootstrapped asynchronously. A Profile without a stored
  enterprise credential does not probe OS encryption. Agent Host owns device
  polling, project discovery, trusted-Workspace binding, endpoint matching, and
  binding recovery. Missing/unsafe secure storage disables only enterprise sign-in.
- [x] 13. Assemble enterprise candidates only from an exact Session Commit
  provenance record, OpenViking Experience, validation receipts, deterministic
  redaction, and explicit user review. Do not treat an arbitrary historical
  Experience summary as a publishable candidate: OpenViking's native Experience
  contract does not itself carry the complete Session/evidence/sensitivity gate.
  Desktop-issued Commit now records a stable Pi JSONL hash and reconciles only the
  exact completed OpenViking task and `memory_diff.json` Experience operations.
  The durable local candidate remains pending until the user confirms outcome,
  applicability boundaries and redaction, then submits it separately to the
  DataHub review queue. Submitted is not shared. The reviewed shared-resource
  publication/search/read/revoke lifecycle and the OpenViking-unavailable native
  Pi Compaction fallback are now proven locally; production promotion remains a
  separate authorized boundary.
- [x] 14. Complete the authenticated enterprise Shared Experience lifecycle
  against the real local OpenViking v0.4.16 Lab. Use only a disposable
  PostgreSQL 16 database, disposable Dragonfly, and a synthetic OpenViking
  Account/Project/Workspace/Candidate namespace; publish, read the exact bytes,
  semantically search through the bound DataHub API, deep-read, revoke-first,
  delete the exact external Resource, prove zero recall, and remove the synthetic
  OpenViking Account plus both temporary containers.
- [x] 15. Audit successful Shared Experience search and deep-read boundaries.
  Search audit stores only a SHA-256 query fingerprint, Project, limit, result
  count, and whether the Gateway was invoked; it never stores the raw query or
  shared content. Real-Lab and deterministic HTTP E2E require publish, search,
  read, revoke, and OpenViking cleanup actions in the disposable audit ledger.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Legacy `pi-67` migration evidence | focused Extension/config/Doctor/conflict/stable-startup-and-Tool-recall tests; historical release-contract and packed-artifact gates | pinned provenance, stable startup prefix, session-aware Tool recall, bounded deep read, truthful effective config, and explicit source selection are preserved during Desktop absorption | PASS as migration evidence: focused OpenViking 17/17, TypeScript, 69/69 release contracts, CLI self-test, packed artifact, and release check passed with the historical missing-`pwsh` warning. The standalone control plane is superseded and is not a current product target. |
| Desktop domain/protocol | focused tests, protocol revision gate, aggregate typecheck | schema and policy contracts pass | PASS: Protocol v4 revision `a0f94c82…`; affected Domain/Protocol/Agent Host/Desktop/Renderer typechecks pass. Typed candidate review, submission, assembly-failure, validation, and promotion-failure contracts are covered. |
| Desktop host/renderer | Agent Host/config/client/router, secure-credential store, Supervisor, candidate assembler/governance, renderer review, authority, binding recovery, isolation, and Compaction fallback tests | no direct renderer service channel; token/private URI/raw Session identity never reaches Renderer or Gateway; states render and recover correctly | PASS: exact Commit provenance, bounded Pi JSONL hashing, OpenViking task/diff reconciliation, deterministic redaction, durable private candidates, explicit review, separate enterprise submission, and submitted-not-shared behavior are covered. Enterprise credential restoration no longer gates Agent Host readiness, and an empty Profile does not probe Keychain. The latest aggregate source gate passes with 642 test files passed, 1 skipped, and 3,305 tests passed; 4 tests are contractually skipped. |
| DataHub migration/backend | migration checks, `cargo fmt`, `cargo check`, `cargo clippy`, `cargo test`, disposable authenticated real-Lab E2E | RBAC, redaction, review, publish/search/read/revoke/audit contracts pass | PASS: 210 ordinary Rust tests passed and 7 opt-in tests were skipped by the ordinary suite; the dedicated harness separately passed the PostgreSQL repository, authenticated HTTP Double, and authenticated real OpenViking v0.4.16 contracts. Migration 018 was applied only to the disposable PostgreSQL database, never production. |
| DataHub frontend | focused Vitest, typecheck, lint, build, route/design/structure gates, and browser67 authenticated Agent Window | Agent route/navigation/permission, healthy, empty, populated, `not_configured`, `unavailable`, and `degraded` states pass | PASS: focused tests, typecheck, lint, production build, protected navigation, semantic-list cleanup, and authenticated visual states pass. The three runtime-state PNGs are current 3024-pixel-wide captures with SHA-256 values `ef35f0a…`, `35ec85c9…`, and `cf77f405…`; the managed task ended with zero remaining tabs. |
| Aggregate source | each repository's required aggregate gate | no unrelated regression introduced | PARTIAL at delivery level: latest Desktop `corepack pnpm run check` PASS, including Protocol revision, typecheck, lint, architecture, dead code, references, structure, production transport, workflow pins, and coverage. DataHub functional Rust/frontend/migration/build gates pass, but its aggregate delivery baseline remains unresolved because the checkout is two commits behind the current local tracking ref; no fetch, pull, merge, rebase, or version normalization was authorized. |
| Runtime/host | local OpenViking v0.4.16 Lab, real Pi/Agent Host contracts, authenticated DataHub Gateway, and disposable enterprise namespace | authenticated data plane, Pi Tool selection, capture, Turn retention, private extraction/recall, shared publication/recall/revoke, and fail-open behavior | PASS locally: the loopback-only arm64 Lab is healthy; private capture, logical-Turn retention, Agent Evolution, search/read/forget, and outage continuation pass. The authenticated enterprise path publishes one reviewed tenant/project-scoped Experience, returns exactly one active allowlisted semantic hit, deep-reads it as untrusted content, revokes and deletes it, then returns zero. Pi chat/local Tools remain available when OpenViking or the Gateway is unavailable. |
| Packaged artifact | unsigned macOS arm64 package, product flow, isolation receipt, and native Compaction-fallback receipt | correct renderer/host wiring; no OM runtime; no credential leakage or local-owner contamination; Pi fallback continuity | PASS on macOS arm64. The current packaged executable SHA-256 is `79019361f697c1a81489dba3e94631b0977770c1ab15236f1f033f9de6238874`. Device Authorization, Workspace binding/recovery, real model-selected `viking_shared_search`/`viking_shared_read`, XML escaping, untrusted projection, Tool-authority non-inheritance, revoke-to-zero, credential expiry, Host epoch recovery, and service degradation all pass. The isolation receipt records zero canonical Session mutations and zero existing-memory injection. With six failed OpenViking connections and zero successful responses, Pi created exactly one native threshold Compaction entry, continued the Session, and resumed the same Session after a second packaged launch. |
| Windows/VPS | real Windows x64 and DataHub VPS acceptance | distribution, Chinese paths, TLS/identity/storage | UNVERIFIED: outside local delivery boundary |

## Rollback

Remove the new Extension registration, Protocol additions, controllers, routes,
tables, and UI entries with scoped patches. Forward database migration rollback
must revoke application use before dropping only the newly introduced Agent
tables. Preserve Pi JSONL, all private OpenViking data, legacy memory backups,
and unrelated worktree changes. Never switch an active Session back to another
Context owner; start a new Session under the restored baseline.

## Risks and unknowns

- OpenViking server/plugin behavior on Windows Chinese user paths remains a real
  release gate even if source tests pass.
- Local and disposable-enterprise acceptance cannot prove production vector
  quality, shared-experience usefulness, or tenant isolation under the DataHub
  VPS deployment; those require production-shaped soak and A/B evidence.
- External OpenViking lifecycle and OS credential integrations require real
  Windows x64 evidence in addition to the completed macOS arm64 evidence.
- The v1 Workspace Peer is a canonical local-root SHA-256. It prevents path
  disclosure and keeps Pi/Desktop aligned, but a repository move still changes
  identity until remote/repository identity migration is implemented.
- Existing DataHub dirty package manifests must not be normalized or rewritten by
  this task; frontend dependency work must use already installed dependencies.
- DataHub remains two commits behind its current local tracking ref, with overlap
  in shared manifests and unrelated WIP; baseline reconciliation is a separate,
  explicitly authorized Git operation.
- The live capability freshness audit on 2026-09-02 observed that the tracked
  browser67 and AI Berkshire refs have advanced beyond this reviewed lock. Exact
  locked-commit reachability still passes and ordinary builds remain reproducible,
  but a future candidate or release must separately review and resolve that drift.

## Progress log

- 2026-08-31: Revalidated all three Git roots and protected unrelated WIP.
  Established the accepted identity, privacy, owner, recall, enterprise review,
  model, timeout, and deployment boundaries as implementation contracts.
- 2026-08-31: Implemented the pinned Pi Extension/CLI, Desktop domain/Protocol/
  Agent Host/UI slice, and DataHub migration/Rust governance API/Agent workspace.
  Added transactional candidate/device operations, one-time HMAC device codes,
  redaction/evidence gates, typed diagnostics, privacy modes, and shared-asset
  lifecycle/audit contracts.
- 2026-08-31: Browser67 confirmed `/agent` redirects through the login boundary
  on an isolated `127.0.0.1:5187` Vite server. The DataHub backend was not running,
  so authenticated workspace pixels were not sampled. Finalization closed only
  the two managed task tabs and preserved unmanaged user tabs.
- 2026-08-31: At that checkpoint, DataHub affected verification exposed and
  drove fixes for the new
  `agent_workspace` protected-navigation contract, readonly permission arrays,
  and `DESIGN.md` authority. The checkpoint's aggregate total-JS 90% headroom
  failure in a pre-existing 96-file dirty diff was later superseded by the final
  functional gates and the separately documented Git baseline boundary.
- 2026-08-31: Corrected the owner-conflict implementation boundary. Desktop now
  freezes a per-Session preload decision and projects conflicting Package
  extensions to disabled, adds exact local Extension exclusions, and filters
  conflicting managed paths without persisting settings. Doctor distinguishes
  installed directories from new-Session startup candidates. The standalone
  Pi Extension and CLI now state that conflict handling is self-disable only.
  Desktop aggregate gate passed with 3,260 tests; pi-67 release contracts passed
  58/58 and release check passed 30 gates with the existing missing-pwsh warning.
- 2026-08-31: Formally retired observational-memory and Hy-Memory as runtime
  alternatives. Desktop no longer bundles or defaults OM, stale managed-package
  state is pruned without deleting memory data, and new Sessions exclude both
  legacy runtimes before loading. A sole OpenViking owner remains eligible;
  only duplicate OpenViking owners cause Memory fail-closed. Pi default
  Compaction remains the built-in fallback rather than a second memory engine.
- 2026-08-31: Re-ran the complete Desktop source gate after retirement (628
  test files, 3,261 tests passed, 3 existing skips), then rebuilt, smoked, and
  opened the unsigned macOS arm64 preview. Its managed package manifest contains
  only `pi-mcp-adapter@2.11.0`; no OM/Hy runtime bytes are present. Pi-67's 58
  release-contract tests and 30 release-check gates pass, with one local warning
  because `pwsh` is unavailable.
- 2026-09-01: First removed per-Turn prefix rewriting with a Session-stable
  cache, then revised the design after product feedback so task switching is
  automatic rather than user-managed. Each meaningful prompt now obtains an
  OpenViking candidate; URI/content similarity suppresses equivalent results,
  while a materially different candidate creates a new Recall Epoch at the
  current user-message anchor. All retained Epochs replay at their historical
  anchors to preserve the provider prefix across Pi deep-copy projections. Pure
  continuation prompts skip retrieval, the adapter retains at most four Epochs,
  changed Branch/Rewind/Takeover projections collapse to and re-anchor the latest
  Epoch, and server cooldown dedup is disabled to avoid false rotations. Session
  Profile and Archive Overview remain in the user-level untrusted envelope.
  Referential switches selectively enable session-aware query expansion without
  adding its model-call latency to ordinary prompts. The
  managed adapter is now `0.1.0-pi67.4` / content revision 5. Focused tests pass
  9/9, aggregate release contracts pass 61/61, and the release check passes 30
  gates with the existing missing-`pwsh` warning.
- 2026-09-01: Superseded the experimental Recall Epoch design before release.
  The adapter now produces one stable startup Recall per OpenViking Session and
  never classifies later task shifts. Pi receives a fixed model policy and calls
  session-aware `viking_search` automatically only when a new task, earlier-work
  reference, or missing history requires it; explicit Tool search enables query
  expansion and returns bounded URI abstracts, while `viking_read` deepens only a
  selected URI. The manual refresh command and all Epoch state/similarity logic
  were removed. Startup Recall and Profile use 1,200-token baselines; private and
  shared Experience default to one each. The managed adapter is now
  `0.1.0-pi67.5` / content revision 6 with hash `ad8f6b71…`. Focused tests pass
  9/9, Pi-67 release contracts pass 61/61, release check passes 30 gates with the
  existing missing-`pwsh` warning, and Desktop's aggregate 628-file / 3,261-test
  gate plus a fresh unsigned macOS packaged smoke pass.
- 2026-09-01: Completed a real isolated OpenViking v0.4.16 lab acceptance on
  OrbStack. Corrected Commit reporting so HTTP 200 no longer conflates an
  accepted archive with `all_within_keep_window`; changed Takeover and Desktop
  Commit to logical-Turn retention; aligned Pi, CLI, and Desktop Workspace Peer
  identity on a canonical-path SHA-256; and added repository-external user-key
  resolution that never reads the Server Root Key. A real four-Turn Pi Session
  archived two messages, retained six, completed one extraction task, wrote one
  private Event, recalled it through the model-selected `viking_search`, and
  deep-read the selected URI before final output. A container-stop exercise
  returned a truthful unavailable Tool Result without blocking Pi, then health
  recovered after restart.
- 2026-09-01: Added an opt-in Desktop live contract and ran it against the lab.
  Agent Host authenticated both service and data planes, read the real Session,
  committed a second hashed-peer Session with three logical Turns retained,
  observed two memory writes, and searched/read the canonical Workspace Memory.
  Desktop aggregate passes 629 files / 3,264 tests; pi-67 passes 67/67 release
  contracts and 30 release checks with only the existing missing-`pwsh` warning.
- 2026-09-01: Bound the validated local user credential to the standard
  repository-external `~/.openviking/ovcli.conf` location with `0600` mode and
  restarted the exact unsigned Desktop preview. A new four-Turn synthetic
  private Session committed eight messages, retained six, completed extraction,
  and wrote one User Event plus one User Entity. A separate Session recalled
  both through Desktop's authenticated User scope. This exposed a real v0.4.16
  integration defect: `memory.get` sent file URIs to `/content/abstract`, which
  returns a parent-directory placeholder. Desktop now uses `/content/read` for
  Memory files and keeps the abstract endpoint for summaries. The opt-in live
  contract then deep-read both records, forgot both exact private URIs, verified
  the marker was no longer recallable, and deleted only the two synthetic test
  Sessions; both Session readbacks returned HTTP 404. Typecheck, diff checks,
  and the complete coverage stage pass with 629 files / 3,264 tests. The first
  aggregate coverage attempt observed two unrelated capability-resolver timing
  failures under load; its exact 4/4 rerun and a full unchanged-input coverage
  rerun passed. A fresh macOS arm64 packaged smoke then passed and opened an
  `app.asar` of 197,693,209 bytes with SHA-256
  `9be204054d1b63aa840de974a59232fc20a888bb2ce6d5f9681a672c7cb0be09`;
  the package contains the corrected `/api/v1/content/read` route.
- 2026-09-01: Corrected the local server capability boundary after task metadata
  proved that ordinary private Memory was active but Agent Evolution still used
  v0.4.16's default `false`. Added `server.agent_evolution.enabled=true` to the
  repository-external lab config, retained a `0600` rollback copy, restarted the
  loopback-only container, and recovered healthy. A synthetic CaseSpec Session
  explicitly limited its policy to `experiences`; the completed commit reported
  Agent Evolution enabled with effective types `cases`, `trajectories`, and
  `experiences`, then created one private Case, one Trajectory, and one Experience.
  Desktop searched and full-read the exact Experience directory successfully.
  The live Forget contract then deleted all three exact private URIs, verified
  no synthetic evolution Memory remained, and deleted the synthetic Session with
  an HTTP 404 readback. The capability switch remains enabled; all synthetic
  acceptance data was removed and no team Resource was created.
- 2026-09-01: Completed the default local Agent Directory cutover. Fixed the
  existing global `--repo-root` maintainer override so an explicit valid Distro
  source wins over an older immutable current release and an invalid explicit
  source fails closed; normal invocations still prefer manager-bundled/current
  immutable releases. Installed `pi67-openviking@0.1.0-pi67.7` revision 8 into
  `~/.pi/agent` with baseline/content hash parity, backed up `settings.json`, and
  removed only the `npm:pi-observational-memory` runtime loading reference while
  preserving its package bytes and private data. Effective Doctor reports one
  eligible owner, no OM/Hy or duplicate OpenViking conflict, and a healthy
  loopback server. A real upstream Pi `--no-session` RPC startup reported
  `OV ✓`; `get_commands` resolved `/viking` from the exact installed local
  Extension path without a model request or Session write. Pi-67 now passes
  69/69 release contracts, TypeScript, CLI self-tests, the packed artifact gate,
  and the release check with only the existing missing-`pwsh` warning.
- 2026-09-01: Implemented the first real Desktop-to-DataHub enterprise identity
  path. Electron Main now owns encrypted short-lived credential persistence and
  refuses unsafe/symlinked storage; Agent Host performs device authorization,
  automatic polling, project discovery, trusted Workspace binding, endpoint
  matching, and remote binding restoration. DataHub gained an authenticated,
  account/user/fingerprint-scoped current-binding read endpoint. Focused Desktop
  tests and all affected package typechecks pass; DataHub fmt/check/clippy and
  205 Rust tests pass with 4 existing PostgreSQL integration tests ignored. The
  protocol revision is `62e99567…`. No migration, VPS, or external service state
  was changed.
- 2026-09-01: Verified against official OpenViking contracts that native
  Experiences are reusable Situation/Approach/Reflect policy files. They do not
  independently contain the exact Pi Session provenance, validation receipts,
  sensitivity classification, and human redaction confirmation required by the
  DataHub candidate gate. Candidate submission and shared recall therefore stay
  truthfully unavailable until the Session-Commit candidate assembler exists;
  no summary-only upload path was added.
- 2026-09-01: Closed the Desktop enterprise-identity validation slice. Updated
  the production-transport invariant to follow the extracted MessageChannelMain
  handoff module, fixed the secure-storage-unavailable result classification,
  and added corrupt/oversized credential-store coverage. The complete Desktop
  aggregate gate passes with 633 test files passed, 1 skipped, and 3,274 tests
  passed. Current macOS arm64 unsigned packaging and packaged Electron smoke
  pass with `app.asar` SHA-256 `2c085b9c…`; Windows, VPS, production identity,
  candidate promotion, and shared retrieval remain unverified.
- 2026-09-01: Implemented the exact Session-Commit candidate assembler and
  Desktop review workflow. Only Experience operations from the completed
  OpenViking task's exact `memory_diff.json` can create a durable local draft;
  deterministic redaction and explicit human outcome/applicability/redaction
  confirmations precede a separate enterprise-review submission. Submitted is
  not shared, and private Experience URIs and raw Session identity stay local.
  Packaging exposed a real startup regression: enterprise credential restoration
  gated Agent Host readiness and probed macOS Keychain even when no credential
  file existed. Agent Host now hands off its Port first and bootstraps enterprise
  identity asynchronously; empty Profiles do not probe OS encryption. The full
  source gate and fresh macOS arm64 packaged smoke pass with 638 test files and
  3,290 passing tests.
- 2026-09-01: Completed the source-level enterprise shared-Experience loop.
  DataHub now publishes only approved candidates to deterministic, tenant/project-
  scoped OpenViking Resources; active database assets remain the retrieval
  allowlist, so revoke blocks recall before best-effort external cleanup. Publish
  recovery reconciles an existing locator/revision after a post-write database
  interruption without creating a second shared asset. Desktop Protocol v3 now
  supports scoped shared search and deep read through the authenticated Gateway,
  and Pi receives two first-party read-only Tools: `viking_shared_search` and
  `viking_shared_read`. Their results are XML-escaped, explicitly untrusted, and
  cannot inherit Tool authority; malformed or spoofed same-name Tools fail closed.
  DataHub Rust fmt, strict Clippy, 207 tests, focused frontend tests/typecheck/lint,
  and the production Vite build pass. Its affected gate passes 70/71 and stops
  only at the release-version check because the dirty checkout is two commits
  behind `origin/main`; no pull or version bump was authorized. Desktop's complete
  gate passes 639 test files plus one skipped, 3,296 tests plus four skipped, and
  coverage of 82.00/76.01/85.94/85.88. A fresh macOS arm64 unsigned package and
  packaged Electron smoke pass; `app.asar` is 197,882,929 bytes with SHA-256
  `bfe2aaffe74aa352e8ca8d3ba16c4e4926c3830f2ee64326be785c5b4edef3f1`.
- 2026-09-01: Added disposable enterprise integration evidence in DataHub. A
  PostgreSQL 16 repository contract verifies idempotent publication/reconcile,
  account/project isolation, active retrieval, revoke-first blocking, and audit
  cleanup. A second authenticated HTTP contract uses the short-lived Agent token,
  current Workspace binding, DataHub routes, and the exact OpenViking write/search/
  delete surface to exercise publish, scoped search, deep read, revoke, and
  post-revoke zero recall. Both pass with an isolated Dragonfly process and leave
  no containers or persistent volumes. The ordinary Rust suite remains 208 pass
  with six opt-in integration tests ignored; fmt, strict Clippy, migration, module
  size, and diff checks pass. DataHub affected is 144/145, with only the known
  release-version baseline failure.
- 2026-09-02: Closed the real local enterprise Shared Experience acceptance.
  The authenticated DataHub API issued a synthetic short-lived Agent identity,
  published one approved Experience to
  `viking://resources/agent/agent-real-e2e/project-real-e2e/experiences/candidate-real-e2e.md`,
  read the exact untrusted reviewed content, returned one active allowlisted hit
  from real semantic search, deep-read it, revoked it, blocked recall immediately,
  deleted the exact OpenViking Resource, and returned zero after cleanup. The
  disposable audit ledger contained publish, search, read, revoke, and external
  cleanup actions. The synthetic OpenViking Account and Resource and the
  disposable PostgreSQL/Dragonfly containers were removed; the existing healthy
  loopback Lab remained running. Root and user credentials were read only from
  repository-external `0600` configuration and were never printed or persisted.
- 2026-09-02: Closed the authenticated packaged product loop. A real macOS arm64
  Desktop obtained a short-lived enterprise credential through DataHub Device
  Authorization, recovered its trusted Workspace binding, and let Pi select
  `viking_shared_search` then `viking_shared_read`. The shared content remained
  XML-escaped and untrusted, did not grant `bash` authority, and no credential
  entered the synthetic Pi JSONL. DataHub UI revoke caused immediate zero recall
  and an old-asset 404 without deleting private Memory.
- 2026-09-02: Proved packaged identity and Session isolation with an independent
  Agent Directory, Electron Profile, Workspace, and synthetic OpenViking identity.
  The receipt records one isolated JSONL Session, zero canonical Session mutation,
  zero non-synthetic OpenViking identity, and zero existing local-owner Memory
  injection; all task-specific runtime state was precisely removed afterward.
- 2026-09-02: Proved native Pi Compaction fallback in the packaged app. An
  unavailable loopback OpenViking endpoint produced six failed connections and
  no successful response; Pi wrote exactly one threshold Compaction entry with
  `fromExtension=false`, continued the next Turn, restarted the package, resumed
  the same Session, and completed another Turn without credential leakage or
  canonical Session mutation.
- 2026-09-02: Re-ran the DataHub runtime-state visual matrix after macOS unlock.
  Browser67 captured authenticated `not_configured`, `unavailable`, and `degraded`
  states at 3024-pixel width with SHA-256 values `ef35f0a…`, `35ec85c9…`, and
  `cf77f405…`; DOM, network, visual state, and fail-open copy agree, and scoped
  finalization left zero managed task tabs.
- 2026-09-02: Audited the final local Git delivery boundary. Desktop remains on
  `be2e39c6201ce1b131955cb57eb7e5c0e66c5b83` with one coupled, uncommitted
  OpenViking/capability-ownership migration. DataHub remains on
  `438e10d019ac13cf3fc029e479eee8a5928e31b9`, two commits behind its current local
  tracking ref with unrelated overlapping WIP. No staging, commit, fetch, pull,
  merge, rebase, push, deploy, migration, VPS access, tag, or release occurred.
- 2026-09-02: Before the local scoped commit, Extension Adapter provenance and
  all four exact capability-source commits verified. The read-only freshness
  audit found newer browser67 and AI Berkshire tracked-ref commits; they were not
  pulled into this already validated scope. Static aggregate gates passed; one
  coverage-load crash-recovery timing sample failed once, then its exact 1/1 test
  and the unchanged complete 642-file/3,305-test coverage rerun passed.

## Closeout

- Final source SHA: unchanged in all repositories; changes are uncommitted by
  explicit delivery boundary.
- Changed files: scoped OpenViking/Context/Agent source, tests, plans, migration,
  route/permission contracts, and DataHub design authority; unrelated dirty WIP
  remains preserved and excluded from ownership claims.
- Validation completed: legacy `pi-67` migration contracts; Desktop aggregate
  coverage, unsigned macOS packaged product flow, Agent Directory/Session identity
  isolation, and native Pi Compaction fallback; DataHub Rust/frontend/migration/
  production-build gates; authenticated Agent workspace and runtime-state visual
  evidence; real local enterprise publish/search/read/revoke/delete/audit cleanup.
- Validation not completed: Windows x64, VPS deployment, production tenant and A/B evidence.
- Remaining risks: DataHub release-baseline reconciliation, production migration
  execution, Windows Chinese-path effective config and credential storage,
  production TLS/storage/tenant isolation, browser67/AI Berkshire release-time
  freshness review, and task-quality A/B evidence.
- Commit/push/release state: uncommitted; no push, deploy, upload, tag, or release authorized.
