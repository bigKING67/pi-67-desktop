# Codemode controlled compatibility prototype

Status: completed (controlled prototype only; production Codemode disabled)

Historical phase record: the later [Desktop integration](2026-10-03-codemode-desktop.md)
supersedes this phase's disabled production state. Prototype tests were promoted
to the `codemode*.integration.test.ts` and `codemode.test-support.ts` files in that
change; the observations below describe the original characterization phase.
Owner: Codex
Started: 2026-10-03
Last updated: 2026-10-03

## Goal

Characterize Pi 1.0.0 Codemode against the current Desktop native MCP, safety,
cancellation and transcript projection contracts using isolated synthetic data.
Produce executable evidence and explicit production-adoption blockers.

## Non-goals and delivery boundary

- Local test implementation and validation are authorized by the accepted
  controlled-prototype recommendation. Production Codemode remains disabled.
- No model routing, Pi Durable, paid provider calls, user profiles or credentials.
- No new dependency, SDK patch, product setting, protocol or renderer behavior.
- Commit/push and candidate/distribution for this new phase are not requested.
  Existing alpha.43 candidate acceptance is unaffected by test-only work.

## Current evidence and decisions

- Entry: clean canonical `main`, local/origin `88307820`; Pi suite exactly 1.0.0.
- `createCodemodeExtension({ mode: "on", models: false })` is a public SDK seam.
  Keep model globals disabled: they are outside this tool-only prototype.
- Production rejects Codemode MCP configuration and has no Codemode factory.
- Use the real Pi loop, QuickJS worker, synthetic stdio MCP and unchanged
  Desktop safety hook. Deterministic model output never calls a provider.
- First measure unchanged root admission. A clearly labeled test-only root
  admission hypothesis may then let the exact prototype Codemode container run
  in PLAN; every nested call must still traverse the original Desktop hook.
  Conditional results do not establish production root admission.

## Acceptance and checkpoints

- [x] Public SDK script execution, direct/deferred MCP and discovery.
- [x] AUTO/YOLO deletion decisions, allowed/denied outcomes and exact child IDs.
- [x] Existing PLAN root rejection, then conditional nested read/write controls.
- [x] Invalid/hidden tools and schema rejection before synthetic server execution.
- [x] Abort, deadline, partial output, same-session reuse and owned process cleanup.
- [x] Live parent/child events, current projection and Session restore behavior.
- [x] Output persistence, model-global isolation and script-store characterization.
- [x] Relevant typecheck/tests/static gates and bounded adoption report.

## Affected boundaries and rollback

Only tests/support under `packages/pi-runtime/src` and this plan. No unrelated
WIP at entry. Remove this scoped prototype diff to roll back; temporary profiles,
synthetic output spill files and recorded child processes are fixture-owned and
cleaned in `finally`, including failure paths. Production artifacts remain intact.

## Validation and risks

Targeted real-SDK integration tests and runtime/tests typecheck first, then the
source aggregate for this safety-sensitive characterization. No packaged or
Windows/manual claim; no UI implementation or visual acceptance in this phase.

## Verified results and adoption blockers

The 16 prototype cases execute the real SDK/QuickJS/stdio pipeline, with synthetic
model messages, synthetic tools and simulated approval decisions. They do not
prove renderer dialogs, packaged workers or Windows behavior.

| Boundary | Observation | Adoption consequence |
| --- | --- | --- |
| Native MCP | Direct/deferred calls and discovery pass; hidden/unknown names and invalid schema never reach the server | Reuse native MCP and Pi nested execution |
| Safety | Each nested deletion has its own child ID; AUTO and YOLO both ask; one allowed call does not authorize the next | Preserve per-child decisions, not a blanket script approval |
| Root admission | Existing AUTO treats the root as an unverified tool and asks once; existing PLAN rejects the root | Define and verify an exact-source Codemode container contract |
| Conditional PLAN | Test-only admission of that exact root allows a built-in read; nested write/deletion remain blocked by unchanged production Safety | This is conditional evidence, not production PLAN support |
| Cancellation | Abort reaches a pending MCP call and pending approval; unawaited parallel work is cancelled; connection reuse passes | Preserve signal propagation and distinguish child outcomes |
| Sandbox | Script deadline and partial output pass; `models`, Node `process` and `fetch` are absent | Use `models: false` for this tool-only scope; model execution remains separate |
| Session store | Successful writes append `codemode-store`; failed writes do not replace the committed value | Adopt bounded Session metadata semantics explicitly |
| Output privacy | Codemode truncation writes full synthetic output to a temporary file despite native MCP `saveOutput: false`; the fixture removes it | An upstream/public output-persistence seam or a separately reviewed exact-version patch is required before activation |
| Projection | Pi emits distinct child IDs and `parentToolCallId`; Desktop live views lose the parent link, normalized transcript has only the root, and the current recovery index cannot reconstruct children | Add bounded parent/child live and Pi-owned durable projections before claiming nested result UX |

Current configured-MCP policy displays a tool-name target for in-workspace effects;
the prototype validates the child ID and validated arguments without relabeling
that display as a canonical-path approval. Workspace-external policy is unchanged.

The native MCP fixture gained only optional test extension injection and a named
test-only Safety wrapper. Existing production Safety/native MCP modules, dependency
pins, SDK patch, settings and renderer contracts are unchanged. A test factory
activation error in the first sample was corrected (`setActiveToolsByName`); its
six owned synthetic process trees and directories were explicitly cleaned, and
setup-failure cleanup is now retained in the helper. That sample is not SDK evidence.

## Validation evidence

- Runtime typecheck passed. Targeted 4 files / 35 tests passed (16 prototype,
  15 native MCP, 4 production tool-routing tests); log:
  `/tmp/pi67-codemode-prototype-targeted.log`.
- Final `corepack pnpm run check:source` passed: 925 files / 6062 tests passed;
  9 files / 24 conditional tests skipped. Coverage: statements 84.12%, branches
  78.56%, functions 86.96%, lines 87.74%. Log:
  `/tmp/pi67-codemode-prototype-source-final.log`.
- The first aggregate sample is retained at
  `/tmp/pi67-codemode-prototype-source.log`: declaration emission exposed an
  inferred-type portability issue in the new helper, corrected with a return
  type annotation; the declaration build and final aggregate have no TS errors.
  An unchanged native-artifact retirement test also failed once. Its isolated
  rerun (8 tests) and final aggregate pass; same-millisecond timestamp ties with
  path sorting are a source-supported hypothesis, not a proven cause for that
  specific sample. No unrelated artifact lifecycle source/test was changed.
- `git diff --check` passed. No production caller imports the prototype or
  Codemode factory. Generated fixture directories and synthetic server processes
  are absent after the suite; individual teardown checks cover recorded child
  processes and output spills. An older `pi67-native-mcp-seams-*` SDK patch scratch
  directory is outside this prototype's fixture ownership and was preserved.
- Final local delivery is five uncommitted files on source
  `883078207105a9ba1c10efff0b2317a4211e44c3`: this plan, three new Codemode test/support
  files and the existing native MCP test helper. Production source is unchanged.
- No production activation, candidate rebuild, user-profile mutation, paid model,
  commit, push or publication in this phase.

## Recommended next implementation boundary (not executed)

1. Define a Desktop-owned exact-source Codemode root identity with `models: false`.
   Preserve the existing per-child safety hook and cancellation path; exercise
   duplicate/forged identities and PLAN admission before activating the container.
2. Resolve Codemode raw-output persistence through an upstream public seam or a
   separately reviewed, exact-version patch. Native MCP's existing `saveOutput`
   option does not cover this behavior.
3. Extend bounded live and restored parent/child projections from Pi Session
   truth, then implement truthful approval, cancellation and child-result display.
   A successful root script must not imply all children succeeded.
4. Update the relevant product/protocol/design contracts with that implementation,
   pass source checks, and obtain packaged macOS and Windows evidence before
   claiming production support. Automatic model routing and Pi Durable remain
   separate decisions; this prototype implements neither.
