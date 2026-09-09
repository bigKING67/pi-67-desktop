# Custom Provider multi-protocol model discovery

Status: complete
Owner: Codex
Started: 2026-09-08
Last updated: 2026-09-09

## Goal

Let one custom Pi Provider use one Base URL and one credential to discover and
import models for the OpenAI, Anthropic, and Gemini protocol families. The
Renderer defaults all three families on, assigns one exact Pi API to every
imported model, and keeps OpenAI Responses as the default OpenAI route.

## Non-goals

- No second model router, agent runtime, or Session truth outside Pi.
- No silent billable generation probe or claim that catalog discovery proves a
  successful model completion.
- No automatic deletion of existing custom models during rediscovery.
- No commit, push, candidate build, upload, release, or production operation.

## Acceptance criteria

- A custom Provider shows a three-family, default-selected discovery control
  instead of requiring one Provider-wide protocol choice.
- One explicit action reads a bounded remote model catalog with a transient or
  existing Pi credential, returns sanitized per-family outcomes, and never
  returns or logs the credential or raw response body.
- Discovered Claude and Gemini models receive `anthropic-messages` and
  `google-generative-ai`; other compatible models receive
  `openai-responses` by default, with model-level manual selection retaining
  `openai-completions` as an explicit compatibility route.
- Imported models are previewed and individually selectable, preserve distinct
  upstream IDs and supplier metadata in the preview, and cannot silently merge
  conflicting same-ID suppliers.
- The Provider-level `api` remains omitted for newly discovered mixed services;
  every new model persists one model-level `api` to Pi `models.json`.
- Existing models, custom API IDs, write-only headers, revisions, and credential
  boundaries remain intact.

## Delivery boundary

- Local implementation: authorized by the user's `继续` after accepting the scheme.
- Commit: authorized by the user on 2026-09-09; this plan is included in the
  scoped Provider commit.
- Push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Pi 0.84.3 supports four persisted API IDs and one effective API per model. | installed Pi `docs/models.md` | 2026-09-08 |
| OBSERVED | The current configuration protocol already supports model-level `api` overrides. | `packages/protocol/src/provider-configuration-schemas.ts` | 2026-09-08 |
| OBSERVED | Existing `provider.modelCatalog.refresh` only targets runtime Providers that implement `refreshModels`. | `packages/pi-runtime/src/pi-model-catalog-refresh.ts` | 2026-09-08 |
| OBSERVED | Groland already proves one Provider/credential with mixed model-level protocols. | `PRODUCT.md`, `DESIGN.md`, current source | 2026-09-08 |
| OBSERVED | The live `127.0.0.1:8317` catalog returned 25 canonical models under shared Bearer (OpenAI 11, Anthropic 6, Gemini 8), while protocol-native catalog headers exposed 44 entries including proxy-generated `claude-fable-*` aliases. | authorized catalog-only live probe; no generation request | 2026-09-08 |
| OBSERVED | The dirty worktree contains unrelated Context/Memory work that must remain untouched. | `git status --short` | 2026-09-08 |

## Affected boundaries

- Modules/processes: Renderer Settings, Protocol, Agent Host, Pi Runtime.
- Protocol or persisted state: new read-only discovery command; existing
  revision-fenced provider and credential mutations; model-level Pi API fields.
- Platform/artifact: shared Renderer/Agent Host source; macOS preview required
  after source gates because this is a user-visible change.
- Security/privacy: transient and stored keys stay inside the existing
  Renderer-to-Agent-Host credential boundary; discovery output is sanitized.
- Existing WIP: Provider API selector and Provider authority-document edits are
  prior task WIP and may be corrected. Context/Memory paths and
  `docs/plans/2026-09-08-new-money-server-extraction.md` are out of scope.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Present three protocol families but persist four exact Pi API IDs. | Matches the user's mental model while preserving Pi's runtime contract. | Pi adds a native multi-API Provider contract. |
| Keep React Aria and the existing Settings primitives. | They already own accessibility and visual grammar. | A verified primitive blocker appears. |
| Use catalog discovery only; do not send generation requests. | Model completion can be billable and needs separate explicit intent. | Product authority adds an explicit paid probe flow. |
| Preserve existing models and append only selected new IDs. | Rediscovery must not become implicit deletion or overwrite. | User chooses a separately confirmed synchronize/replace mode. |
| Default aggregate services to one shared Bearer catalog read; retain protocol-native headers as explicit compatibility mode. | The live gateway exposed canonical identities through Bearer and cross-protocol proxy aliases through native headers. | A provider contract can authoritatively distinguish canonical and per-protocol routable catalogs. |

## Checkpoints

- [x] 1. Add bounded protocol schemas and a tested Pi Runtime discovery coordinator.
- [x] 2. Route the read-only discovery command through Agent Host without mutation-ledger secret retention.
- [x] 3. Replace the Provider-wide protocol control with default-on family selection, credential input, result preview, and import-to-draft behavior.
- [x] 4. Update PRODUCT/DESIGN/process authority and targeted tests.
- [x] 5. Run affected typechecks/tests, aggregate source gate, browser validation, and the default unsigned macOS preview.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | affected package typechecks | no TypeScript errors | PASS: Protocol, Pi Runtime, Agent Host, and Renderer |
| Tests | targeted Protocol/Pi Runtime/Agent Host/Renderer tests | behavior and secret-boundary assertions pass | PASS: 38 tests across 8 files; latest delta rerun passed 32/32 across 6 files |
| Source aggregate | `corepack pnpm run check` | aggregate source gate passes | PARTIAL: all static stages passed on the first run; coverage passed 3774 tests and failed 4 unrelated real-Git tests under concurrency, whose 25/25 isolated rerun passed. A second aggregate run was blocked at lint by an unrelated concurrent unused import in `eng/capabilities/probe-openviking-native.mjs`. |
| Runtime/host | managed browser Settings flow with mocked/local deterministic discovery | family controls, preview, import, focus and error states observed | PASS: current Browser67 light desktop evidence confirmed all four default selections and no horizontal overflow; Playwright passed bootstrap plus the exact discovery flow. Screenshot SHA-256 `0392f935b369c20f368ede9adcc88a0e717a958abd9de7a3891131db6933aa3e`. |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | package, smoke, and repository artifact launch succeed | PASS: darwin/arm64 smoke and repository `New Money.app` launch; `app.asar` SHA-256 `f43407f1450070998b7d1b97abda7e92a6e740ee1ff8d9b203ff40656da11cc8`. |
| Target OS/manual | Windows x64 manual acceptance | real Windows evidence | not authorized/unavailable |

## Rollback

Revert only the scoped files listed in this plan from a reviewed task diff. Do
not reset the worktree or alter unrelated Context/Memory WIP. Because discovery
is read-only until the existing explicit Save actions run, cancelling or leaving
the page discards transient results and the transient API key.

## Risks and unknowns

- Third-party gateways expose several catalog shapes and may not identify a
  model's request protocol. The implementation must mark catalog-only evidence
  honestly and retain per-model manual protocol correction.
- Multiple suppliers with the same raw request model ID cannot both be persisted
  under one Pi Provider unless the gateway supplies a distinct routable ID.
- Saving `models.json` and `auth.json` remains two explicit revision-fenced
  mutations; credential failure must surface as a recoverable partial state.

## Progress log

- 2026-09-08: Rechecked live Git, Pi API contracts, existing refresh behavior,
  credential containment, authority, and the prior single-select WIP. Began the
  multi-protocol discovery implementation without touching unrelated WIP.
- 2026-09-08: Added app-scoped inspect/cancel commands, bounded shared-catalog
  discovery, per-family and per-model selection, exact Pi API persistence,
  credential-safe combined save, and recovery tests. Split the UI, controller
  tests, and E2E flow along existing responsibility boundaries to satisfy the
  repository structure gate.
- 2026-09-08: Browser67 verified the light desktop and dark narrow layouts. The
  E2E flow verified default-on families, Responses priority, keyboard exclusion
  of Anthropic, per-model APIs, supplier-routed IDs, and redacted credential
  commands. System review found no P0/P1 visual, interaction, or accessibility
  issue; focus styling is source-covered and keyboard behavior is executed by
  Playwright.
- 2026-09-08: The first aggregate coverage run had three unrelated concurrent
  Worktree timeout/temporary-directory failures; the two affected files passed
  10/10 in isolation. A clean second aggregate run passed 717 files and 3732
  tests. The unsigned macOS preview then built, smoked, and launched the exact
  repository artifact.
- 2026-09-08: With explicit user authorization, a catalog-only live probe used the
  configured local credential without printing it. Shared Bearer returned 25
  canonical models (11 OpenAI, 6 Anthropic, 8 Gemini); protocol-native headers
  returned 44 entries because the Anthropic view added proxy aliases. Reopened the
  implementation to make the canonical Bearer path the default single read and keep
  native headers as an explicit compatibility mode. No generation request ran.
- 2026-09-08: Revalidated the final default against the same live gateway. One
  shared-Bearer catalog GET returned 25 canonical models: 11 OpenAI, 6 Anthropic,
  and 8 Gemini, with zero conflicts, no truncation, and no proxy aliases. Browser67
  confirmed the three protocol families plus aggregate Bearer are selected by
  default; the exact Playwright flow and unsigned macOS packaged smoke passed.

## Closeout

- Working-tree base SHA: `d3fc303754aa6096a4905632282dbcd200f1ac5b`
- Changed files: scoped Provider discovery UI, controller, Protocol, Agent Host,
  Pi Runtime, E2E, and authority documents; unrelated Context/Memory WIP remains
  present and untouched.
- Validation completed: affected typechecks; 38 targeted tests across 8 files;
  exact discovery E2E; authorized catalog-only live request to
  `127.0.0.1:8317`; Browser67 current default-state and overflow review; macOS
  arm64 package, smoke, launch, and `app://pi67` main-window read-only check.
- Aggregate validation is PARTIAL only because unrelated concurrent Worktree
  timing failures and a separate OpenViking unused import prevented one clean
  end-to-end `check` exit; every reported Worktree failure passed in isolation.
- Validation not completed: no real generation request and no Windows x64 manual
  acceptance.
- Remaining risks: catalog metadata can only infer protocol family; ambiguous
  models remain manually correctable. Same raw request ID from multiple named
  suppliers is rejected until the gateway supplies distinct routable IDs.
- Commit/push/release state: scoped commit authorized on 2026-09-09; push,
  candidate, and release remain unauthorized.
