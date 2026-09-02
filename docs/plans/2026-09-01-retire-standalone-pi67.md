# Retire standalone pi-67 control plane

Status: local implementation complete; release retention and Windows gates remain
Owner: Codex
Started: 2026-09-01
Last updated: 2026-09-01

## Goal

Make Pi TUI and Pi-67 Desktop the only user entrypoints. Move every still-needed
Pi resource and OpenViking adapter authority into `pi-67-desktop`, let Desktop
transactionally manage the shared Pi Agent Profile used by both entrypoints,
and remove all build, runtime, update, Doctor, and user-workflow dependence on
the standalone `pi-67` CLI, distro, release store, and repository.

## Non-goals

- Do not fork or replace upstream Pi, its agent loop, ResourceLoader, Package
  semantics, Session lifecycle, or Pi JSONL truth.
- Do not delete Pi JSONL Sessions, OpenViking private data, credentials, user
  Packages, user Rules/Skills, legacy-memory backups, or divergent user files.
- Do not deploy DataHub/OpenViking enterprise services in this migration.
- Do not archive or delete the remote `pi-67` repository without separate
  external-action authorization.

## Acceptance criteria

- `pi-67-desktop` owns the source and provenance of the OpenViking Pi Extension,
  active first-party Rules, Prompts, Skills, and the rules loader.
- Desktop capability preparation and packaging succeed when `../pi-67` is absent
  and without fetching `bigKING67/pi-67`.
- No Desktop source, lock, build, runtime, update channel, Doctor, product copy,
  or test treats the standalone manager/repository as an active authority.
- Desktop transactionally projects one verified capability version into the
  canonical Pi Agent Profile with `staging / active / previous / receipt`
  semantics. Pi TUI and Desktop load the same OpenViking and resource hashes.
- Existing exact known `pi67-openviking` bytes are adopted without changing
  OpenViking data or any in-flight Session; divergent/unknown bytes fail closed.
- `pi-67 install/update/doctor/openviking` and `~/.pi/pi67/current.json` are no
  longer required for normal use, repair, update, or rollback.
- A real no-Session Pi RPC load, Desktop source gates, packaged macOS smoke, and
  rollback acceptance pass. Windows remains an explicit target-platform gate.

## Delivery boundary

- Local implementation: authorized across `pi-67-desktop`, the current shared
  Pi Agent Profile, and migration-only reads from the sibling `pi-67` checkout.
- Commit: not authorized.
- Push: not authorized.
- Candidate build/upload: local unsigned package only; no upload authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Pi TUI and Desktop share `~/.pi/agent` and Pi JSONL; upstream Pi is the only runtime. | Product contracts and live Pi RPC | 2026-09-01 |
| OBSERVED | Desktop already owns Package mutation, trust receipts, capability staging/activation, Skill Packs, Provider settings, Doctor, updates, and OpenViking UI/operations. | Current Desktop source and packaged smoke | 2026-09-01 |
| RESOLVED | Desktop capability sources no longer resolve `pi67-core`, `../pi-67`, or `bigKING67/pi-67`; workspace resources and the OpenViking adapter are first-party packages in this repository. | Source/reference audit, capability source lock, and prepared package integrity | 2026-09-01 |
| VERIFIED | The live Agent Profile has no OM/Hy-Memory directories; `pi67-openviking` is the sole Memory owner and its top-level projection exactly matches the active shared package. | Live bounded Agent Profile inspection and directory hash parity | 2026-09-01 |
| VERIFIED | Real Pi 0.80.6 `--mode rpc --no-session --offline` exposes exactly one `/viking` command from the top-level shared projection, with no model request or Session write. | Live upstream Pi RPC `get_commands` | 2026-09-01 |
| VERIFIED | Local OpenViking v0.4.16 is healthy on loopback and accepts an authenticated root resource read without exposing the configured credential. | Live `/health` and bounded `/api/v1/fs/ls` probe | 2026-09-01 |

## Affected boundaries

- Modules/processes: capability preparation, Agent Host startup, Pi runtime
  resource loading, Package/Skill management, OpenViking management, Renderer
  settings and diagnostics, packaging and release gates.
- Protocol or persisted state: Desktop capability manifest/receipt, Pi
  `settings.json`, app-owned capability overlay, installed local Extension path.
- Platform/artifact: macOS arm64 and Windows x64 Desktop packages; upstream Pi
  TUI using the canonical Agent Profile.
- Security/privacy: no credential or Memory data migration; bounded path and
  hash validation; existing user content preserved; new Sessions only.
- Existing WIP: the accepted OpenViking vertical slice and unrelated dirty
  Desktop/pi-67 changes remain preserved; scoped edits must not overwrite them.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Pi TUI and Pi-67 Desktop are the only user entrypoints. | A third manager creates duplicate ownership and user confusion without executing the Agent. | A future independently justified control plane has unique duties Desktop cannot own. |
| `pi-67-desktop` becomes the source authority for its Pi resources and OpenViking adapter. | Runtime, UI, packaging, compatibility, and update contracts then evolve atomically. | Resources become a separately staffed, independently released product with proven multi-consumer need. |
| Desktop projects verified resources to one stable shared Agent Profile location instead of keeping Desktop-only and TUI-only copies. | Both entrypoints must load identical bytes and rollback together. | Upstream Pi provides a signed cross-client capability registry with equivalent receipts and rollback. |
| User-visible pi-67 CLI commands are retired, not embedded behind Desktop buttons. | Preserve behavior contracts without retaining a parallel product mental model. | None; developer-only quality scripts may remain under Desktop `eng/`. |
| Remote repository archive/deletion is deferred to a separately authorized final action. | It is external and difficult to reverse; local decoupling must be proven first. | User explicitly authorizes archive/deletion after two stable releases or equivalent evidence. |

## Checkpoints

- [x] 1. Inventory all active code, source, build, runtime, persisted-state, and
  documentation dependencies on standalone pi-67.
- [x] 2. Import OpenViking Extension and first-party resource sources with exact
  provenance and source/installed hash evidence.
- [x] 3. Replace `pi67-core` and Skill Pack adapter authority with Desktop-owned
  packages and remove the sibling/remote pi-67 capability source.
- [x] 4. Add transactional shared-profile projection/adoption and rollback.
- [x] 5. Prove Pi TUI and Desktop load one OpenViking/resource version.
- [x] 6. Retire user-facing manager/update/Doctor/release-store references and
  migrate the current machine without deleting user data.
- [x] 7. Build, test, package, and run without any `pi-67` source or runtime authority.
- [ ] 8. Retain a bounded migration rollback for two stable Desktop releases;
  archive/delete external assets only after separate authorization.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | dependency/reference audit, source lock, preparation, and tree hash parity | no active standalone pi-67 authority | pass |
| Tests | focused capability, projection, owner, Package, Protocol and host tests; aggregate check | migrations fail closed and preserve user state | pass; 628 files / 3255 tests, plus 8/8 Renderer E2E |
| Runtime/host | real Pi `--no-session` RPC plus Desktop Agent Host | same source paths/hashes; exactly one `/viking` registered | pass |
| Packaged artifact | unsigned macOS arm64 package and packaged smoke | artifact contains all required resources and starts `ready` | pass; final Agent Host startup 993 ms |
| Target OS/manual | Windows x64, Chinese user path, update/rollback | real target-host evidence | pending |

## Rollback

- Keep the bounded migration backup through two stable Desktop releases. The
  backup is app-external user state and is not included in Git or packaged output.
- The preflight backup is
  `~/.pi/agent/desktop-capabilities/migration-backups/2026-09-01-retire-standalone-pi67-preflight`
  and contains only the pre-migration settings plus the two adopted Extensions.
- A failed projection leaves `active` and Pi settings unchanged; a failed
  post-activation check swaps `previous` back before any new Session is opened.
- Do not remove the sibling checkout or remote repository during source migration.

## Risks and unknowns

- Windows acceptance cannot be inferred from macOS; Windows x64 and a real
  Chinese username path remain release gates.
- The bounded migration backup must remain present through two stable Desktop
  releases; elapsed release retention cannot be proven in this implementation turn.
- Remote `pi-67` repository archive/deletion and any VPS/DataHub deployment are
  external actions and remain unauthorized.
- Computer Use observed the packaged native workbench and the new Inspector tabs,
  but its channel closed after invoking Settings. Renderer Settings behavior is
  covered by E2E; a complete native Settings visual pass remains unverified.

## Progress log

- 2026-09-01: User selected the two-entrypoint architecture and explicitly
  authorized implementation. Live audit confirmed Desktop already owns the
  management primitives; remaining dependencies are the pi67-core resource
  snapshot/Skill Pack adapter and OpenViking Extension source.
- 2026-09-01: Removed the standalone skill-pack registry/update channel, imported
  Desktop-owned workspace resources and OpenViking packages, and added one
  transactionally activated shared Pi Profile with active/previous/receipt state.
- 2026-09-01: Backed up the live Agent Profile without exposing secrets, adopted
  the exact known OpenViking and Rules Loader trees, preserved divergent-file
  fail-closed behavior, and verified no OM/Hy-Memory Owner is installed.
- 2026-09-01: Fixed packaged browser67 resolution to accept only the verified
  bundled root or active shared Profile root after the first smoke exposed a
  degraded startup. The corrected packaged smoke passed and opened the unsigned
  macOS arm64 app.
- 2026-09-01: Real upstream Pi RPC verified exactly one `/viking`; local
  OpenViking v0.4.16 health and authenticated root-resource access passed.
- 2026-09-01: Final aggregate source gate passed with 628 test files and 3,255
  tests passing (one file and four tests skipped by their existing contracts),
  followed by a fresh unsigned macOS arm64 packaged smoke and live shared-profile
  parity for all five first-party packages.

## Closeout

- Final source SHA: unchanged because no commit is authorized; work remains in
  the current dirty checkout.
- Changed files: Desktop-owned capability source/preparation, shared-profile and
  compatibility projection, OpenViking Context/Memory contracts and UI, Package
  management cleanup, tests, design/product authority, and this execution plan.
- Validation completed: focused tests, source lock/provenance gates, real Pi RPC,
  live OpenViking health, Renderer E2E 8/8, aggregate check, and unsigned macOS
  packaged smoke with a 993 ms final Agent Host startup.
- Validation not completed: Windows and external repository archive.
- Remaining risks: Windows real-host evidence, two-release backup retention, and
  native Settings visual completion.
- Commit/push/release state: uncommitted; no push, upload, deploy, tag, release,
  or repository archive authorized.
