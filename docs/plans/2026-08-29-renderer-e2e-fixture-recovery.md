# Renderer E2E Fixture Recovery

Status: active
Owner: Codex primary session
Started: 2026-08-29
Last updated: 2026-08-29

## Goal

Restore the ordinary Renderer E2E lane by correcting proven browser-fixture
execution races, then bind a new exact source SHA to Windows and macOS candidate
evidence and replace the three existing Feishu candidate files.

## Non-goals

- Do not change Renderer conversation, support-upload, Pi runtime, Session, or
  operation behavior to accommodate a broken mock.
- Do not change the support diagnostics schema, upload endpoint, Worker, Durable
  Object, R2 bucket, lifecycle, rate limit, account configuration, or usage.
- Do not weaken E2E assertions, increase Playwright assertion timeouts, retry a
  failing product action, or hide browser page errors.
- Do not create a Tag, GitHub Release, R2 update publication, or promotion.

## Acceptance criteria

- The mock command handler passed to `page.evaluate` has no imported runtime
  dependency for conversation page metadata.
- The support-upload pending test waits for the mock upload bridge to receive
  the request before resolving its pending Promise.
- The Inspector geometry test waits for the lazy WorkspaceShell Composer before
  measuring overlap ownership.
- The five previously failing conversation E2E cases and the support-upload E2E
  pass together without retries, followed by the complete Renderer E2E lane and
  aggregate source gate.
- A scoped commit is pushed only after local validation passes.
- A new exact-SHA Windows Candidate passes its formal lifecycle gate, and exact
  macOS arm64 DMG/ZIP artifacts pass packaged verification before the three
  existing Feishu files are overwritten.

## Delivery boundary

- Local implementation: authorized by the user's `按你的建议继续`.
- Commit: authorized after validation.
- Push: authorized for the new exact-SHA CI and Candidate.
- Candidate build/upload: one new Windows Candidate and exact three-file Feishu
  replacement are authorized after source gates pass.
- Tag/release/promotion: not authorized.
- Cloudflare/R2: no calls or mutations are authorized or required.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Ordinary CI run `33246192969` failed only after the Renderer E2E job failed; Quality, Windows native smoke, and macOS native smoke passed. | GitHub Actions jobs | 2026-08-29 |
| OBSERVED | Five conversation tests issue `message.page`, then time out because the browser raises `ReferenceError: pageMetadata is not defined`. | CI trace and exact-SHA local reproduction | 2026-08-29 |
| OBSERVED | Commit `541e718` moved `pageMetadata` from inside the `page.evaluate` installer closure to a Node module import. | Git history and live source | 2026-08-29 |
| OBSERVED | The support-upload CI trace calls `finishPending()` while the UI is collecting diagnostics; the bridge resolver is created only after `diagnostics.collect` and the later upload call. | CI trace and live test/controller source | 2026-08-29 |
| OBSERVED | The first complete local Renderer rerun passed 203/204 and failed Inspector overlap while its trace still showed the lazy conversation loading surface and no Composer; the isolated test repeated the same missing precondition. | local Playwright trace and isolated rerun | 2026-08-29 |
| OBSERVED | The worktree starts clean at `9c9b75a`, exactly equal to upstream and remote `main`. | live Git | 2026-08-29 |

## Affected boundaries

- Modules/processes: Playwright Renderer mock command installer, support-upload
  E2E synchronization, CI, Candidate provenance, and Feishu candidate mirror.
- Protocol or persisted state: none.
- Platform/artifact: test-only source change; new artifacts remain required for
  exact source-to-candidate identity.
- Security/privacy: no diagnostic bytes, payloads, credentials, paths, or remote
  support service calls are added.
- Existing WIP: none; the canonical checkout was clean before editing.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Install a self-contained conversation command handler through `page.evaluate`. | The first direct in-place restoration exceeded the governed file-size limit; extracting the complete cohesive handler keeps all runtime helpers in one browser closure and follows the existing mock-handler seam. | A supported bundling seam proves imported runtime dependencies are installed into the page. |
| Wait for one observed upload attempt before resolving pending upload. | The bridge invocation, not the earlier UI state, is the exact point at which the resolver exists. | The product contract changes so collection and upload become one synchronous bridge call. |
| Wait for the Composer before sampling Inspector overlap. | A missing lazy surface is not evidence about stacking ownership; the original geometry assertions remain unchanged. | The Inspector contract no longer depends on the Composer plane. |
| Keep every existing behavior assertion and timeout. | The failures are fixture execution defects, not slow product behavior. | New evidence shows a real product deadline is invalid. |

## Checkpoints

- [x] 1. Recheck clean Git and correlate both failures to exact source lines and CI traces.
- [x] 2. Apply the minimal test-fixture fixes and pass the focused cases.
- [x] 3. Pass full Renderer E2E, affected typecheck, and aggregate source gates.
- [ ] 4. Audit and create the scoped commit, push, and verify exact remote parity.
- [ ] 5. Pass a new exact-SHA Windows Candidate and exact macOS packaged preview.
- [ ] 6. Replace and verify the exact three Feishu candidate files.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | scoped diff, `git diff --check`, affected typecheck, aggregate check | only plan and test-fixture paths; all source gates pass | `PASS`: diff check, tests TypeScript, structure governance, and `corepack pnpm run check` passed; aggregate tests passed 3199 with 3 skipped and 614/614 coverage files |
| Tests | focused cases, then complete Renderer Chromium E2E with CI worker settings | no retries, page errors, or stale pending uploads | `PASS`: focused final-structure run passed 23/23; complete final-structure lane passed 204/204 with two workers and zero retries |
| Runtime/host | exact macOS unsigned preview | packaged smoke and real Agent Host roundtrip pass | pending |
| Packaged artifact | formal exact-SHA Windows Candidate | cross-version dual-profile lifecycle passes | pending |
| Target OS/manual | operator testing on the target Windows laptop | remains separate from hosted Candidate evidence | pending |

## Rollback

Revert only this plan, the restored in-closure helper, the removed single-caller
helper module, and the upload test synchronization line. No product state,
protocol, Worker, R2, Feishu permission, or migration rollback is required.

## Risks and unknowns

- GitHub-hosted Windows lifecycle evidence does not prove the user's Defender,
  EDR, OneDrive, redirected profile, or hardware behavior.
- Feishu folder-level direct-child verification remains unavailable without the
  configured destination folder token; exact existing file-token overwrite and
  unique-title verification are the available authority.

## Progress log

- 2026-08-29: User authorized continuation. Rechecked clean exact remote parity,
  retained a zero-Cloudflare/R2 boundary, and began the minimal fixture repair.
- 2026-08-29: Focused conversation/upload E2E passed 22/22. The first complete
  Renderer rerun passed 203/204 and exposed an independent Inspector test that
  sampled overlap before the lazy Composer existed; the isolated test reproduced
  the same precondition failure, so the test now waits for that required surface.
- 2026-08-29: The repaired Inspector test passed 2/2 with its bootstrap, then the
  complete Renderer Chromium lane passed 204/204 with two workers and no retries.
- 2026-08-29: The first aggregate gate passed typecheck, lint, architecture,
  dead-code, and reference governance, then rejected the direct helper restoration
  because `pi67-renderer-command-fixture.ts` reached 474 lines over its 460-line
  limit. The cohesive conversation command handler was moved into its own
  self-contained page installer rather than weakening the structure gate.
- 2026-08-29: On the final extracted structure, focused Renderer E2E passed
  23/23, the aggregate source gate passed all governed checks and 3199 tests
  (3 skipped), and the complete Renderer Chromium lane passed 204/204 with two
  workers and zero retries.

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
