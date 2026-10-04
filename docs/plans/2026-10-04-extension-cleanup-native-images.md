# Extension cleanup and SDK-native image generation

Status: complete within the local offline acceptance boundary
Owner: Codex
Started: 2026-10-04
Last updated: 2026-10-05

## Goal

Remove the explicitly accepted redundant packages from the local shared Pi
Profile, disable advisor, and replace the disabled pi-image-gen package with
image generation through Pi 1.0.0's public ModelRegistry seam.

## Non-goals and delivery boundary

No commit, push, remote deployment, release, new provider adapter, paid generation,
credential migration, arbitrary Codemode model calls or user-data deletion.
Local source changes, isolated synthetic verification and the standard macOS
unsigned preview are authorized. Existing disabled optional packages and rewind
remain installed. Image-gen credentials/configuration remain untouched.

### Authorized source delivery, 2026-10-05

After local acceptance and independent read-only review, the user explicitly
authorized a scoped commit of this feature, a separate commit for the manual-probe
Knip entry and packaged acceptance record, and pushing them with the existing
`dc22b92e` runtime-retirement commit to `main`. This supersedes only the initial
commit/push exclusion above. Follow the new source SHA through Windows/macOS CI
and rebuild/verify the local macOS package. No paid generation, real-Profile
destructive acceptance or external artifact publication is included.

The delivery review found no blocking defect in Tool identity/authorization,
SDK image execution, Session wiring or image projection. Current local source
acceptance passed 6,343 tests; the exact dirty preview and remaining evidence
limits are recorded in `2026-10-05-packaged-pi-acceptance.md`.

## Current evidence and affected boundaries

- Pi suite is pinned to 1.0.0; ModelRegistry.generateImages/getAvailableOfType
  are public. Codemode currently fixes models:false.
- The SDK's built-in image API is openrouter-images. The local Profile has no
  configured OpenRouter identity/image model; native integration cannot prove
  the old OpenAI Images endpoint compatible or produce a paid real image.
- Parent, transitioned and child Pi Sessions share custom-tool registration.
  Image results already use generation-bound asset references in the Renderer.
- Protect existing CI/recovery WIP: .github/workflows/ci.yml,
  docs/plans/2026-10-04-ci-reliability-performance.md, docs/testing/ci.md,
  eng/packaging/packaged-task-recovery-workflow.test.mjs,
  eng/packaging/verify-packaged-task-recovery.mjs, and the new bootstrap/test files.

## Decisions and acceptance

- Two bounded first-party tools discover authenticated SDK image models and
  generate with an explicit provider/model. No fallback/model switch.
- Generate through ModelRegistry, preserve SDK usage, cancellation and standard
  image content. Optional local references use ctx.executeTool(read), retaining
  canonical read identity and every nested authorization boundary.
- Discovery is read-only. Generation is a paid external submission: AUTO asks
  once, PLAN rejects, YOLO follows existing policy; forged identities fail closed.
- Keep Codemode models:false. Scripts may invoke the same admitted image tool.
- Remove pi-subagents, pi-web-access, pi-smart-fetch and pi-plan-mode; the MCP
  adapter is already absent. Disable advisor. Remove pi-image-gen only after
  native source tests pass. Preserve all unrelated Profile resources.

## Checkpoints and validation

- [x] Implement native image tools, exact safety identity and all Session wiring.
- [x] Verify real SDK synthetic image provider, errors, abort, nested reference
  reads, usage/JSONL, PLAN/AUTO/YOLO and forged/duplicate identities.
- [x] Clean accepted local packages with a bounded rollback copy and verify
  remaining configuration/installed versions unchanged.
- [x] Pass affected typechecks and complete source gate; validate existing image
  presentation and package/smoke/open the macOS preview.
- [x] Record source/runtime/package evidence and unverified paid/Windows layers.

## Completed evidence

- The five accepted installed sources are outside active npm/Git install paths;
  the shared Profile now contains 12 packages instead of 17. Advisor exposes only
  an extension in its resource manifest and now has `extensions: []`. Rewind and
  the other disabled packages remain. No MCP adapter was installed to remove.
  Seven retained npm package manifests and all non-package settings were verified
  unchanged. Shared dependencies were preserved rather than applying npm's
  357-package uninstall/prune plan.
- The private rollback copy is
  `~/.pi/agent/package-cleanup-backups/2026-10-04T14-14-17-751Z/`;
  `receipt.json` records exact moves and metadata backups. `packages-before.json`
  contains only the previous package list. Legacy image-gen configuration and
  all auth, memory and Session data remain untouched.
- Runtime typecheck, scoped lint and diff checks passed. The complete source
  gate passed with 948 test files / 6,278 tests, 9 skipped files / 24 skipped tests;
  statement coverage 84.29%, branch coverage 78.77%. Fifteen new SDK-image tests
  cover discovery, real SDK auth/usage/JSONL, references, errors, cancellation,
  Codemode and AUTO/PLAN/YOLO identity policy. After adding the image-card browser
  regression, the test TypeScript check and scoped lint passed separately.
- Renderer Chromium: 4 tests passed, including bootstrap, chunked image asset
  lifetime/retry and SDK-image Tool card/model identity. The frontend route was
  L1-F, existing PRODUCT/DESIGN authority, no visual-token changes; design-craft
  governed the existing asset presentation. A browser67 managed Chrome fixture
  verified app/bridge bootstrap but did not establish image-card display; no
  visual PASS is inferred from that background sample. Its managed tab was
  finalized: closed=1, verified=1, remaining_unkept=0, errors=0. Browser67's fixture
  server was stopped.
- The initial package failed before the first Electron window. ASAR inspection
  found invalid `package.json` bytes. A temporary ad-hoc signature experiment
  did not fix that failure; the subsequent fresh unsigned packaging replaced the
  experiment and produced JSON whose SHA-256 matched the ASAR integrity header.
  No release certificate or signing credential was used. This records artifact
  corruption, without attributing an unproven packaging root cause.
- Fresh macOS arm64 package smoke passed: production app://pi67, sandbox, real
  Agent Host, native MCP, image asset warm/cold restoration and bounded shutdown.
  The repository preview was opened and its real window checked through Computer
  Use. app.asar: 195,130,591 bytes,
  SHA-256 `ea37efed0382c6f3ad123ead8dcf00e1038684710548a68b9a7ed7e44557b0ee`.
  This is a local working-tree preview, not an immutable release candidate.
- Real paid image generation and Windows acceptance remain unverified. The
  current Profile has no configured SDK-native image provider; OpenRouter
  configuration remains a separate user action. No credential migration,
  paid request, commit, push or external distribution was performed.

## Rollback

Restore only this task's source diff. Keep a mode-0700 Profile rollback directory
outside Git with the exact settings and removed package sources/manifests; never
print its contents. Restore settings only after checking for concurrent edits.
No session, memory, auth, image-gen config, browser profile or unrelated WIP changes.

## Risks and unknowns

Real native image generation requires an SDK-supported image provider with
credentials. No paid request is part of this acceptance. Windows remains
unverified locally. The preview includes concurrent working-tree changes and
cannot be represented as an immutable source-SHA release candidate.
