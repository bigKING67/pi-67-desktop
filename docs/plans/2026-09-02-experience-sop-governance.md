# Experience to SOP governance

Status: complete for the authorized local Desktop and DataHub governance slice
Owner: Codex
Started: 2026-09-02
Last updated: 2026-09-03

## Goal

Make Desktop and DataHub distinguish one-task Cases, reusable Experiences, SOP
candidates, versioned SOPs, and executable Skills. Strengthen local Experience
review with a structured method, add server-owned multi-source SOP aggregation,
then add a dedicated governed lifecycle for publishing, versioning, recalling,
restoring, and revoking formal SOP assets.

## Non-goals

- Do not auto-promote a successful task into an SOP.
- Do not expose raw Pi JSONL, private OpenViking URIs, credentials, or source
  Session identities to Renderer or the enterprise Gateway.
- Do not add another Agent, Memory, Context, or Tool authority.
- Do not publish or recall an SOP candidate through the existing Experience
  asset path.
- Do not apply a production migration, connect to the VPS, or modify production
  OpenViking resources.
- Do not commit, push, package a release candidate, deploy, tag, or release.

## Acceptance criteria

- Every exact Session-Commit candidate carries one pseudonymous task Case and
  raw private OpenViking Experiences remain explicitly unverified.
- Experience review requires preconditions, ordered key steps, validation gates,
  completion criteria, failure modes, and a rollback or non-applicability reason.
- The Gateway receives the reviewed strategy and structured method as distinct
  bounded fields; legacy Experience assets without a method remain readable.
- Only DataHub can aggregate an SOP candidate, from at least three active shared
  successful Experiences across two Workspaces in one Account/Project.
- Only an approved, threshold-satisfying SOP candidate can publish a formal SOP;
  each version has an immutable locator and DataHub permits one active version
  per Account/Project/stable key.
- Revoking the active version immediately removes it from recall; restoring a
  retained version atomically deactivates the current version and is audited.
- Pi exposes separate `viking_sop_search` and `viking_sop_read` Tools, returns at
  most one active current-Project match, and always treats the body as untrusted
  context without granting execution authority.
- Desktop shows the knowledge stage and why an Experience is not yet eligible
  to become an SOP candidate; fewer than three independent Cases can never pass.
- Existing v1 local candidate files remain readable and are migrated
  non-destructively when the v2 store is next written.
- Domain, Protocol, Agent Host, and Renderer focused tests pass; aggregate and
  macOS preview validation follow if the affected gates are clean.

## Delivery boundary

- Local implementation: authorized in `pi-67-desktop` and the existing DataHub
  Full Trellis task.
- Commit: not authorized.
- Push: not authorized.
- Production DataHub/VPS/database: excluded; disposable local PostgreSQL is
  allowed for contract validation.
- Candidate build/upload, tag, release, promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main` is clean and ahead of `origin/main` by three local commits. | live Git | 2026-09-02 |
| VERIFIED | Current candidates have problem, strategy, result, applicability, evidence, and redaction, but no Case lineage or structured process. | live Domain/Protocol/Host source | 2026-09-02 |
| VERIFIED | DataHub now accepts a structured Experience method and owns a non-publishing SOP-candidate aggregation lifecycle. | current DataHub schema/routes/tests and managed-browser evidence | 2026-09-02 |
| VERIFIED | DataHub owns a distinct versioned formal-SOP lifecycle and Pi has current-Project bounded SOP search/read Tools. | current source, disposable PostgreSQL, authenticated HTTP, real OpenViking, and focused Desktop tests | 2026-09-02 |

## Affected boundaries

- Modules/processes: Desktop Domain, Protocol v4, Agent Host candidate
  store/assembler/Gateway client, Pi shared-read Tool, Renderer Experience
  Inspector; DataHub migration, Agent repository/routes, and governance UI.
- Protocol or persisted state: additive candidate fields and a v1-to-v2 local
  store migration; no Pi JSONL or OpenViking mutation format change.
- Platform/artifact: source plus macOS arm64 unsigned preview; Windows remains
  unverified.
- Security/privacy: Case IDs are hashes; private Session IDs and URIs stay in
  Agent Host storage and never enter enterprise content.
- Existing WIP: none at start; the three preceding local commits remain intact.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| One successful task creates a Case-backed Experience candidate, never an SOP. | One path can be accidental and has not established an organizational standard. | An approved policy supplies equivalent multi-Case evidence and governance. |
| SOP readiness requires at least three successful Cases across two Workspaces plus a complete structured method. | Prevents a single local success from masquerading as a reusable standard. | Production A/B evidence justifies a different explicit threshold. |
| The Gateway transports `strategy` and `method` separately. | Preserves machine-readable steps, gates, failures, and rollback without duplicating them inside an opaque field. | A future versioned wire contract replaces both fields. |
| Formal SOP publication is a DataHub governance action; Desktop/Pi can only search and deep-read the active version. | Publishing requires server-owned review, version activation, expiry, restore, revoke, and audit, while Pi only needs bounded task-time retrieval. | A future governed organization-asset service replaces DataHub and preserves the same separation. |
| DataHub alone creates SOP candidates from shared Experience IDs. | The server can prove Account/Project scope, active lifecycle, source immutability, Workspace diversity, and supersession. | A stronger trusted governance service replaces DataHub as the policy authority. |
| A published SOP is a distinct `sop` asset, not an Experience or `sop-candidate` asset. | Search, version activation, expiry, rollback, and recall need a lifecycle separate from evidence-bearing Experiences. | A future versioned organization-asset service replaces the DataHub asset registry. |
| Every SOP version uses an immutable versioned OpenViking locator and DataHub selects the sole active version. | Versioned locators preserve rollback and prevent revoking an old version from deleting the current version. | OpenViking gains a native atomic version/alias primitive with equivalent audit guarantees. |
| Pi receives only `viking_sop_search` and `viking_sop_read`; SOP content remains untrusted and never auto-executes. | Organizational approval establishes reuse eligibility, not Tool authority or present-task correctness. | None; this is a permanent security boundary. |

## Checkpoints

- [x] 1. Add Domain taxonomy, Case lineage, structured Experience method, and SOP-readiness policy.
- [x] 2. Add Protocol fields and a non-destructive local candidate-store migration.
- [x] 3. Update candidate assembly/review and structured Gateway transport.
- [x] 4. Update the Experience Inspector terminology, review form, and readiness feedback.
- [x] 5. Update PRODUCT/DESIGN authority and pass focused/aggregate/runtime validation.
- [x] 6. Add DataHub migration 019, server-owned SOP aggregation, immutable
  provenance, review UI, and disposable PostgreSQL/browser evidence.
- [x] 7. Add migration 020 and a dedicated SOP publish, active-version,
  expiry, restore, revoke, search, read, and audit lifecycle.
- [x] 8. Add Desktop SOP search/read Tools with project-bound Gateway
  validation and untrusted deep-read rendering.
- [x] 9. Verify the lifecycle against disposable PostgreSQL/OpenViking
  doubles, DataHub browser UI, and the current macOS arm64 package.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Domain/Protocol | focused Vitest and typecheck | taxonomy, schema, thresholds, revision | PASS |
| Agent Host | candidate assembler/store/flow tests | v1 migration, redaction, structured wire compatibility | PASS |
| Renderer | Experience Inspector tests and typecheck | required fields and honest readiness copy | PASS |
| Aggregate source | `corepack pnpm run check` | no source regression | PASS: 650 files, 3,338 tests; 4 skipped; 82.09% statements |
| DataHub backend | fmt/check/clippy/test, migration/size, PostgreSQL and real OpenViking contracts | aggregation, version activation, idempotency, restore, revoke, and cleanup | PASS: 212 regular tests; 6 disposable Agent contracts including real OpenViking v0.4.16 |
| DataHub frontend | focused/full tests, typecheck, lint, build, browser67 | separated Experience/SOP stages, formal-version controls, responsive layout | PASS: 49 files/189 tests; 3024 x 1534 managed-browser visual, clean Console, and no horizontal overflow |
| DataHub Runtime states | disposable authenticated fixture plus browser67 | distinct `not_configured`, `unavailable`, and HTTP 503 `degraded` UI; private-memory/fail-open boundaries; pixels agree with DOM | PASS: dedicated Agent window; three 3024 x 1646 PNGs; clean Console; zero failed requests; no horizontal overflow; fixture receipt `8df60d07-b6e9-4224-bd27-5a566e20d3ee` |
| macOS package/runtime | `corepack pnpm run preview:mac:unsigned` | current assets, packaged roundtrip, and launch | PASS: fresh package/smoke/launch; app.asar SHA-256 `69f302b78beb466e34f77ebe2729506af86ae79832eb6a0d8783886cfa72c113` |
| macOS current native visual | Computer Use AX/PNG inspection | current packaged pixels and accessibility projection | UNVERIFIED: the Computer Use native pipe failed again after a clean runtime reset, before app inspection; no AppleScript or stale screenshot was substituted |
| Windows/DataHub production | separate authorized work | target evidence | excluded |

## Rollback

Revert only this plan's Desktop Domain, Protocol, Agent Host, Pi Runtime,
Renderer, PRODUCT/DESIGN changes and DataHub migrations 019/020 plus Agent
governance changes. Keep the legacy v1 candidate file untouched; the v2 store
and both database migrations are additive. Roll back formal SOP routes and Tools
together so an orphaned publication or recall surface cannot remain. Do not
change Pi JSONL, OpenViking private data, existing enterprise Experience assets,
or the preceding local commits.

## Risks and unknowns

- The current semantic duplicate/conflict gate relies on reviewed source state;
  richer cross-version contradiction analysis remains future governance work.
- Production migration, TLS, persistence, tenant-isolation smoke, and real
  cross-user A/B outcomes remain unverified.
- Windows x64 behavior is unverified in this local slice.

## Progress log

- 2026-09-02: Audited the clean Desktop baseline, current OpenViking candidate
  path, Product/Design authority, and Protocol/store compatibility boundary.
- 2026-09-02: Implemented the Case lineage and structured Experience method,
  added the deterministic SOP-readiness policy, preserved the legacy DataHub
  wire shape, and added non-destructive v1-to-v2 local-store compatibility.
- 2026-09-02: Completed focused and aggregate source gates. Packaged and opened
  the current macOS arm64 app; packaged smoke passed and native AX exposed the
  single Context entry with Session/Memory/Experience detail tabs. An initial
  native screenshot remained on the previous File projection after AX selected
  Context and was rejected as an invalid sample. A fresh read then showed AX
  and pixels in agreement on the Experience panel, including its four metrics,
  empty state, and governance boundary, with no wrapped primary navigation.
- 2026-09-02: Added DataHub migration 019, server-owned multi-Experience SOP
  aggregation, immutable source lineage, semantic versions, expiry and
  supersession; kept ordinary SOP publication and recall closed. Updated Desktop
  to send and deep-read the structured method as a first-class field. Disposable
  PostgreSQL contracts, DataHub frontend gates, browser67 UI review, Desktop
  focused tests, static gates, and serial aggregate coverage pass.
- 2026-09-03: Added DataHub migration 020 and the formal SOP asset lifecycle:
  immutable versioned locators, one active version, expiry, restore, revoke,
  retrieval blocking, and audits. Added current-Project bounded
  `viking_sop_search`/`viking_sop_read` Tools whose deep-read output is escaped
  and untrusted. Re-ran strict DataHub Rust gates after responsibility-based
  module splits, all six disposable Agent contracts, and the real OpenViking
  v0.4.16 write/search/read/revoke/delete path. Browser67 verified the Candidate
  and formal-SOP tabs in its dedicated Agent window. A fresh macOS arm64 package,
  packaged smoke, and launch passed; the separate Computer Use native pipe was
  unavailable before it could inspect the current app.
- 2026-09-03: Closed the earlier DataHub Runtime visual-evidence gap with a new
  disposable authenticated fixture. Browser67 captured and visually reviewed
  separate `not_configured`, `unavailable`, and HTTP 503 `degraded` PNGs in a
  dedicated Agent window; all three matched fresh DOM and runtime status, had
  zero failed requests, zero Console errors/warnings, and no horizontal
  overflow. The scoped browser tab, PostgreSQL, Dragonfly, and anonymous volume
  were removed. A separate retry of the current packaged Desktop remained
  blocked before inspection by the Computer Use native pipe.

## Closeout

- Base source SHA: `5e7919a01676f4213e161b5a8fede6187802fab3`; authorized changes remain uncommitted
- Changed files: Desktop Domain and Protocol Experience/SOP contracts; Agent Host
  assembler, review, store migration, structured Gateway client; Pi shared
  Experience and formal-SOP read Tools; Renderer Experience Inspector and
  structured review form; PRODUCT/DESIGN authority; DataHub migrations 019/020,
  Agent repository/routes/tests, versioned SOP governance UI, and the active
  project plans
- Validation completed: focused tests, protocol revision, repository typecheck,
  lint, architecture, dead-code, reference, structure, production transport,
  workflow pins, serial aggregate coverage, unsigned macOS package, packaged
  smoke, app launch, prior native Experience-panel inspection, disposable
  DataHub PostgreSQL contracts, authenticated browser67 SOP UI, the three-state
  Runtime PNG/DOM/Network/Console matrix, and real OpenViking formal-SOP
  publication/search/read/revoke/delete cleanup
- Validation not completed: current-artifact native AX/PNG inspection because
  Computer Use could not start its native pipe; Windows and production
  migration/VPS remain excluded
- Remaining risks: formal SOPs are recallable but intentionally never executable
  or authoritative; richer semantic conflict analysis, production, and
  target-Windows evidence remain separate gates
- Commit/push/release state: no commit, push, deploy, tag, or release authorized
