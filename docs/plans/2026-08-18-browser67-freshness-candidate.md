# Browser67 remote freshness and internal candidate

Status: active
Owner: Codex
Started: 2026-08-18
Last updated: 2026-08-18

## Goal

- Bind the bundled browser67 source to the current canonical remote `main` commit while retaining an immutable, reproducible Desktop source lock.
- Make scheduled, Windows candidate, and signed-release provenance fail when a branch-tracked first-party capability advances beyond its locked commit.
- Produce one new Windows x64 and macOS arm64 internal candidate set from one exact Pi-67 Desktop source SHA and mirror the three product files to the configured Feishu folder for target-OS testing.

## Non-goals

- Do not retire or rename `pi67-core` in this change. It remains a migration-stage capability source with real Prompt, Rule, Extension, Skill, and overlay consumers.
- Do not make Desktop runtime follow a floating Git branch, clone an upstream repository at startup, or use the local dirty/diverged `pi-67` checkout as artifact authority.
- Do not create a stable Tag, GitHub Release, signed build, notarization, or promotion.

## Acceptance criteria

- The browser67 lock commit equals canonical `refs/heads/main` at the time source is frozen, and its packaged version/extension identity remain valid.
- Branch-tracked first-party source refs are validated and compared by exact commit; malformed or advanced refs fail closed.
- Windows candidate provenance runs and retains the bounded capability freshness report before dependency install or packaging.
- Targeted tests, full quality gates, exact packaged Browser67 MCP live smoke, exact macOS arm64 unsigned preview, and hosted Windows candidate gates finish successfully.
- Feishu contains only the three current versioned product files after authorized replacement and verification; each file is bound to size and SHA-256 evidence.

## Delivery boundary

- Local implementation, commit, push, Windows/macOS candidate builds, and Feishu upload/old-candidate cleanup: authorized by the user on 2026-08-18.
- Stable release, Tag, signing, notarization, and promotion: not authorized.

## Current evidence

| State | Evidence | Verified at |
| --- | --- | --- |
| OBSERVED | Canonical browser67 `refs/heads/main` and the clean local checkout resolve to `bb43570f139feafc2632f8da19f34b4863e6bccb`. | 2026-08-18 |
| OBSERVED | The previous Desktop lock used post-tag commit `c2394ca7810e01fed73dbba34a29bac8e1be5196`; extension implementation files are unchanged through current main, while governance/docs changed. | 2026-08-18 |
| OBSERVED | The corrected packaged live smoke completed MCP initialize, tools/list, and tools/call for 18 `tmwd_browser` tools and 60 `js-reverse` tools with exact identity match. | 2026-08-18 |
| OBSERVED | The local `pi-67` checkout is dirty and diverged, while its canonical remote main equals the existing Desktop lock commit `500f3f63a14d80b0297a1dcc04237b5e2cf87894`. | 2026-08-18 |

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Track browser67 and pi67-core by canonical `refs/heads/main`, but consume only exact lock commits. | Detects new reviewed post-tag work without sacrificing reproducibility or allowing runtime network drift. | Upstream adopts a reliable stable release cadence and Desktop elects tag-only consumption. |
| Defer pi67-core retirement. | It still supplies multiple live capability classes and the local TUI repository has unintegrated WIP; deletion now would be an unsafe cross-product migration. | A separate migration proves zero Desktop consumers and replaces every authoritative asset. |
| Run freshness in candidate provenance. | A Windows candidate used for acceptance should not knowingly test a stale first-party baseline. | Candidate policy explicitly permits a reviewed stale exception with recorded approval and immutable evidence. |

## Checkpoints

- [x] 1. Re-establish dirty tree, upstream refs, capability consumers, and exact live Browser67 evidence.
- [x] 2. Implement source-ref freshness, update exact locks, candidate workflow, tests, and documentation.
- [x] 3. Refresh prepared capabilities and complete targeted/full/package gates.
- [ ] 4. Increment candidate version, create a scoped commit, push exact source SHA, and build both target-platform candidates.
- [ ] 5. Verify identities/hashes, upload the three products to Feishu, remove superseded candidates as authorized, and re-list the destination.

## Rollback

- Revert only the source-ref freshness, lock, workflow, documentation, and candidate-version changes from this plan.
- Restore the previous immutable browser67 commit only if exact packaged Browser67 validation fails; never substitute a floating runtime checkout.
- Do not touch the local `pi-67` WIP or its branch history.

## Risks and unknowns

- Existing stable-tag or Skill Pack sources may already be stale and can block the newly enforced candidate freshness gate; resolve them explicitly rather than weakening the gate.
- Hosted Windows evidence does not replace the user's Windows x64 installation test.
- Chrome owns unpacked-extension source selection; Desktop can prepare and diagnose the managed source but cannot mutate the user's browser profile.

## Progress log

- 2026-08-18: User authorized completing the new internal candidate and Feishu delivery while deferring pi67-core retirement.
- 2026-08-18: Browser67 live-smoke provenance was isolated from the outer Pi-67 Desktop Git repository; the exact packaged MCP live chain passed.
- 2026-08-18: Branch-tracked source freshness now compares immutable locks with canonical remote refs; the Windows candidate workflow retains the bounded report before dependency installation.
- 2026-08-18: Freshness exposed stale design-craft and AI Berkshire locks. Both were refreshed to their current reviewed source revisions, prepared capability hashes were regenerated, and all five locked sources now pass reachability and freshness.
- 2026-08-18: Full source gates passed with 568 test files, 2,938 passed tests and 3 skips. Alpha.27 packaged Electron smoke and exact Browser67 live smoke passed with 18 tmwd_browser and 60 js-reverse Tools.
