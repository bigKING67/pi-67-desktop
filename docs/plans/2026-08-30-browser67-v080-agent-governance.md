# browser67 v0.8.0 Agent governance and bundled extension

Status: completed
Owner: Codex
Started: 2026-08-30
Last updated: 2026-08-30

## Goal

Upgrade the Pi-67 Desktop bundled browser67 capability from v0.6.0 to v0.8.0,
carry the same immutable browser67 identity through its Pi Skills, MCP runtime,
and unpacked Chrome/Edge extension source, and synchronize the canonical
`pi67-core` browser rule with the new managed Agent Window and focus lifecycle.

## Non-goals

- Do not add a second prompt composer, browser router, agent loop, or Session truth.
- Do not edit generated capability artifacts as source or bypass exact Git locks.
- Do not overwrite the unrelated `pi-67/mcp.example.json` worktree change.
- Do not reload the user's currently installed Chrome/Edge extension, inspect
  unrelated browser state, or claim a live identity match without a new Doctor receipt.
- Do not commit or push the Desktop repository, and do not tag, release, upload,
  publish, or deploy either repository.

## Acceptance criteria

- [x] Canonical `pi-67` browser governance names the v0.8.0 dedicated-window,
  background-focus, guarded lease, effective-transport, adoption, and scoped
  finalization contracts without duplicating the browser67 Tool schema.
- [x] Prompt-governance and rules-loader tests fail if the updated browser rule
  stops being routed or loses its key safety/default contracts.
- [x] Pi-67 Desktop locks browser67 v0.8.0 at commit
  `c9d45ae020ca502390b4b4838d924ace0d8e60d7` and updates all product fixtures.
- [x] Prepared browser67 capability contains v0.8.0 Skills, MCP sources, Agent
  Window extension files, package `gitHead`, and a setup-built extension identity
  bound to the same commit.
- [x] The updated `pi67-core` rule reaches the Desktop package from remotely
  fetchable immutable commit `e7ec566d339c7dfa661cb19b1de50047cfb059e2`.

## Delivery boundary

- Local implementation: authorized in `pi-67` governance sources and Pi-67 Desktop.
- Pi rule commit/push: authorized and completed as one scoped remote commit.
- Desktop commit/push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| BASELINE | Before this change, Desktop selected browser67 v0.6.0 at `3c1d224...` and pi67-core at `56c13da...`. | capability source lock and diff | 2026-08-30 |
| VERIFIED | browser67 v0.8.0 is clean at annotated tag and `main`, commit `c9d45ae...`. | local Git identity and source | 2026-08-30 |
| VERIFIED | v0.8.0 changes the managed-tab schema to revision 4 / managed-tabs-v5, defaults to dedicated/background/non-active work, and includes platform-native Agent Window extension/runtime files. | browser67 Skill, schema, capability and extension source | 2026-08-30 |
| VERIFIED | Canonical `pi-67` source carries those lifecycle defaults and the corrected run-backed job contract at remote commit `e7ec566...`; governance 53/53, loader 2/2, and content contracts 8/8 pass on that exact remote-based candidate. | remote Git identity, `AGENTS.md`, `rules/browser.md`, focused tests | 2026-08-30 |
| VERIFIED | Desktop catalog `2026.08.30.3` locks pi67-core at `e7ec566...` and browser67 at `c9d45ae...`; prepared and packaged AGENTS/browser rule hashes equal the remote source. | capability lock, prepared package, packaged application | 2026-08-30 |
| OBSERVED | The canonical local `pi-67` checkout retains unrelated `mcp.example.json` WIP and its pre-existing divergent history; the scoped remote integration used and then removed one temporary worktree. | live Git/worktree status | 2026-08-30 |

## Affected boundaries

- Modules/processes: pi67-core AGENTS/rules/loader tests; Desktop capability lock,
  capability fixtures, packaged browser67 live smoke, and generated local capability output.
- Protocol or persisted state: browser67 managed-tabs schema v4/v5 and installed
  extension identity; no Pi JSONL or product database change.
- Platform/artifact: macOS arm64 local unsigned package; Windows behavior remains
  unverified without a real Windows x64 host.
- Security/privacy: preserve unmanaged/adopted tab ownership, background focus,
  exact Browser Instance routing, and identity-matched extension loading.
- Existing WIP: preserve all Desktop local commits and `pi-67/mcp.example.json`.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Keep operational detail in `rules/browser.md`, browser67 Skills, and live Tool schemas; keep AGENTS compact. | Avoids divergent protocol copies and preserves Pi ResourceLoader precedence. | Pi adopts a new authoritative routing seam. |
| Bind Package, MCP, Skill, and extension source to one browser67 commit. | Prevents a new runtime from shipping with an old extension or instruction contract. | browser67 publishes independently signed component identities. |
| Do not point the Desktop pi67-core lock at uncommitted local changes. | Capability preparation requires exact, clean, reproducible Git source. | A remotely fetchable immutable source commit exists. |

## Checkpoints

- [x] 1. Update and validate canonical pi67-core browser governance.
- [x] 2. Refresh browser67 v0.8.0 lock and every exact-version product fixture.
- [x] 3. Prepare capabilities and verify package/Skill/schema/extension byte identity.
- [x] 4. Run focused and aggregate source gates.
- [x] 5. Package/smoke/relaunch the macOS unsigned preview with both immutable
  sources integrated; record the remaining Windows gap explicitly.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| pi67-core source | prompt governance + rules-loader tests | browser route and v0.8 contracts pass | PASS: governance 53/53; loader 2/2 |
| Desktop source | capability tests, related Agent Host/Desktop tests, typecheck/lint | lock and identity consumers pass | PASS: 44 focused tests; typecheck/lint; Renderer E2E 8/8; aggregate 622 files / 3,236 passed / 3 skipped |
| Capability | source reachability, preparation, catalog/package inspection | pi67-core e7ec566 and browser67 v0.8.0/c9d45ae plus new extension files | PASS: five sources reachable/current; catalog `2026.08.30.3`; pi67-core AGENTS SHA-256 `12f1b3db...`, browser rule `a50f13e1...`; browser67 schema 4 / managed-tabs-v5; prepared browser tree SHA-256 `762d6354...` |
| Extension build | run packaged `browser67 setup` into a temporary target and inspect build identity | version, revision, digest and protocol are exact | PASS: 0.8.0, c9d45ae, package_git_head, dirty=false, source digest `638900d2...`, protocol 2; Agent Window files present |
| Packaged artifact | unsigned macOS package and smoke | packaged resources carry exact prepared capability | PASS: package/smoke/relaunch passed; packaged catalog `2026.08.30.3`, pi67-core `e7ec566...`, browser67 `0.8.0/c9d45ae...`; packaged AGENTS/browser rule and Agent Window file hashes match prepared sources; app.asar SHA-256 `75c4d70a...` |
| Live browser | packaged MCP initialize/list/call and live Doctor | current Chrome/Edge extension identity match | PASS: extension_identity_ok, identityMatch=true, 18 tmwd_browser tools, 60 js-reverse tools |
| Windows | real Windows x64 Agent Window acceptance | maximized UI-preserving window and guarded focus restore | UNVERIFIED: no real Windows x64 host |

## Rollback

Restore the prior browser67 lock, catalog version, fixtures, and governance text
with scoped patches. Regenerate ignored capability/package outputs from the restored
lock. Do not modify the user's installed browser extension or unrelated WIP.

## Risks and unknowns

- Local macOS source/package checks cannot prove Windows maximized-window behavior.
- The current loaded browser extension passed the v0.8.0 identity gate, but that
  point-in-time live receipt must be rechecked after later extension or browser changes.

## Progress log

- 2026-08-30: Audited all prompt/rule/Skill/Tool/bootstrap layers, confirmed the
  two-source update requirement, and froze the v0.8.0 source identity.
- 2026-08-30: Updated local pi67-core AGENTS/browser governance and regression
  gates while preserving `mcp.example.json`; focused source checks pass.
- 2026-08-30: Locked and prepared browser67 v0.8.0 at `c9d45ae...`; verified
  Skills, managed-tabs-v5 schemas, Agent Window extension files, and a temporary
  extension build bound to package_git_head rather than the enclosing Desktop Git HEAD.
- 2026-08-30: After explicit authorization, created local scoped commit
  `d588160...`, cherry-picked only that change onto current remote `main` in one
  temporary worktree, verified the exact candidate, and pushed remote commit
  `e7ec566...`; the unrelated local history and `mcp.example.json` stayed out.
- 2026-08-30: Locked pi67-core to `e7ec566...`, prepared catalog
  `2026.08.30.3`, verified byte parity, reran the full Desktop gate and Renderer
  E2E, rebuilt/relaunched the macOS package, and passed packaged live browser identity.

## Closeout

- Final source SHAs: pi67-core `e7ec566d339c7dfa661cb19b1de50047cfb059e2`;
  browser67 `c9d45ae020ca502390b4b4838d924ace0d8e60d7`
- Changed files: local pi67-core governance/tests/docs; Desktop browser67 lock,
  fixtures, packaged smoke expectation, and this plan
- Validation completed: focused/full source, exact capability, extension build,
  macOS package/smoke/relaunch, packaged live browser identity
- Validation not completed: Windows x64 acceptance
- Remaining risks: Windows maximized/focus behavior remains unverified on a real Windows host
- Commit/push/release state: pi67-core scoped commit and push completed; Desktop
  remains uncommitted/unpushed; no tag, release, upload, publish, or deploy
