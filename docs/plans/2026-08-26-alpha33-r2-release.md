# Alpha.33 R2 release

Status: active
Owner: root agent
Started: 2026-08-26
Last updated: 2026-08-26

## Goal

Publish `0.1.0-alpha.33` through the internal unsigned R2 channel from one exact
`main` source SHA. The release includes the committed scoped t3code mechanisms,
the mutable-manifest cache fix, and the Windows update lifecycle repair that pins
the existing installation, relaunches the new version, and preserves a valid
Desktop shortcut when one existed before update.

## Non-goals

- Do not overwrite Alpha.32 immutable artifact names or bytes.
- Do not create a Git tag, GitHub Release, signed release, or public promotion.
- Do not sign or notarize the artifacts.
- Do not delete Alpha.31 or Alpha.32 artifacts before exact Windows and macOS
  programmatic upgrades pass and cleanup receives separate authorization.
- Do not persist R2, GitHub, or Feishu credentials in Git or release evidence.

## Acceptance criteria

- All eight workspace manifests report `0.1.0-alpha.33` on a clean `main` source
  equal to `origin/main`.
- The full repository gate passes for the exact release source.
- Windows Candidate builds from that exact SHA, passes hosted gates, and its x64
  NSIS EXE receives real Windows manual acceptance.
- macOS arm64 DMG/ZIP build from the same source and pass exact packaged smoke.
- R2 plan reports no immutable conflicts or unknown objects; publish verifies all
  three public artifacts before switching the manifest last with `no-store`.
- An installed Alpha.32 Windows copy updates through the app, remains in the same
  installation directory, automatically starts Alpha.33, and retains a working
  Desktop shortcut if it existed before the update.
- An installed Alpha.32 macOS arm64 copy updates and restarts as Alpha.33.

## Delivery boundary

- Local implementation: explicitly authorized on 2026-08-26.
- Commit: explicitly authorized for all current uncommitted Alpha.33 content.
- Push: authorized as part of continuing the exact Alpha.33 publication.
- Candidate build/upload: authorized as part of continuing the exact Alpha.33
  publication; target-machine acceptance remains an evidence gate.
- R2 upload: explicitly authorized for exact `0.1.0-alpha.33`, subject to the
  candidate and public-readback gates.
- Tag/release/promotion: excluded.
- Old-version deletion/cache purge: excluded until separate post-upgrade approval.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main` contains local commit `541e7181b1e0bc94caf5af664c1205acf3163c02` over `origin/main` `776615c2a26eefa3a721554218b5009e6845ab60`; it is the completed scoped t3code mechanism program. | live Git and commit metadata | 2026-08-26 |
| OBSERVED | Alpha.32 Windows application replacement reached the new executable, but did not relaunch it and left an existing Desktop shortcut with a missing target. | real Windows target-machine execution and screenshots | 2026-08-26 |
| OBSERVED | The local remediation passes `--force-run`, pins the final NSIS `/D=` to the running executable directory, and rewrites only a Desktop shortcut that existed before the update. | updater, NSIS include, and focused tests | 2026-08-26 |
| OBSERVED | The mutable R2 manifest now carries `Cache-Control: no-store`; local release tooling has a regression test for future manifest writes. | live public headers and release tooling tests | 2026-08-26 |
| OBSERVED | The complete repository gate passed before the Alpha.33 version bump with 589 test files, 3,047 passing tests, and 3 skipped. | `corepack pnpm run check` exit 0 | 2026-08-26 |

## Affected boundaries

- Modules/processes: Desktop updater, NSIS packaging, Renderer/Pi Runtime and
  Worktree/attachment mechanisms already committed in `541e7181`.
- Protocol or persisted state: protocol revision and resource projections from
  `541e7181`; no additional updater persistence migration.
- Platform/artifact: Windows x64 NSIS EXE and macOS arm64 DMG/ZIP.
- Security/privacy: exact artifact identity, repository-external release
  credentials, bounded HEIC normalization, and explicit Worktree effects.
- Existing WIP: all current tracked modifications are explicitly included; no
  unrelated untracked files remain at plan creation.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Release as Alpha.33 rather than overwrite Alpha.32. | R2 artifact names are immutable and Alpha.32 is already public. | None; Alpha.32 bytes must remain immutable. |
| Bind Windows NSIS `/D=` to `dirname(process.execPath)`. | Live evidence showed application and shortcut continuity cannot rely only on installer registry state. | A verified updater API supplies an equivalent exact-install authority. |
| Recreate a Desktop shortcut only when it existed before update. | Repair the stale target without overriding a user's decision to remove the shortcut. | Product explicitly changes shortcut ownership. |
| Retain Alpha.31 and Alpha.32 through target upgrades. | They are recovery baselines until the new lifecycle is proven. | Both target upgrades pass and cleanup is separately authorized. |

## Checkpoints

- [ ] 1. Commit every current modification with Alpha.33 version metadata and
  prove clean `main` equals `origin/main` after push.
- [ ] 2. Run the exact-source full gate and build/verify macOS arm64 artifacts.
- [ ] 3. Build the exact-SHA Windows Candidate and obtain real Windows acceptance.
- [ ] 4. Prepare and credential-check the R2 bundle; ensure the read-only plan has
  no conflict or unknown-object blocker.
- [ ] 5. Upload immutable artifacts, verify public bytes/hashes/Range, and publish
  the `no-store` manifest last.
- [ ] 6. Verify Alpha.32-to-Alpha.33 in-app upgrades on Windows x64 and macOS arm64.
- [ ] 7. Record closeout and leave old-version cleanup pending separate approval.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `corepack pnpm run check` on exact source | every required gate exit 0 | pending exact Alpha.33 SHA |
| Tests | updater/NSIS/release tests and full coverage | lifecycle flags, destination, shortcut, no-store | source tests passed; exact source pending |
| Runtime/host | packaged smoke on both candidates | exact artifact startup and runtime receipts | pending |
| Packaged artifact | candidate identity and R2 bundle verification | version/source/size/SHA-256 binding | pending |
| Target OS/manual | Windows/macOS installed in-app upgrades | before/after versions and lifecycle | pending |

## Rollback

Before the Alpha.33 manifest switch, leave the public Alpha.32 manifest and all
older files unchanged. If post-publication verification fails, restore the
previous manifest before any object cleanup. Never overwrite a versioned file;
preserve failed candidate bytes and credential-free receipts for diagnosis.

## Risks and unknowns

- Source tests do not prove NSIS macro compilation, Windows shortcut behavior, or
  post-install relaunch; exact Windows Candidate and target-machine evidence are
  mandatory.
- The large committed t3code mechanism set expands packaged smoke scope, notably
  HEIC normalization and Worktree lifecycle.
- Clients that cached an older mutable manifest before `no-store` may still need
  cache expiry; new responses prevent recurrence but cannot evict existing bytes.

## Progress log

- 2026-08-26: User authorized exact Alpha.33 publication and committing all
  current work. Live Git found completed local commit `541e7181` plus the updater
  and R2 release-tooling remediation; all eight manifests were moved to Alpha.33.

## Closeout

- Final source SHA: pending
- Changed files: pending exact commit
- Validation completed: pre-version full source gate and focused updater tests
- Validation not completed: exact candidates, R2 publication, target upgrades
- Remaining risks: Windows NSIS lifecycle and expanded packaged feature scope
- Commit/push/release state: pending
