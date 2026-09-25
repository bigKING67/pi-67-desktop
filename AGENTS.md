# Pi-67 Desktop Repository Instructions

## Reading and authority

- Read this file before making changes. Before editing an affected area, locate
  and read the relevant sections of its authority documents using the routing
  below. Do not read every authority document in full for every task. If the
  scope or a referenced contract is unclear, expand the read before editing.
- Product behavior and non-goals: `PRODUCT.md`.
- UI, interaction, and visual tokens: `DESIGN.md` and `DESIGN.dark.md`.
- Process boundaries and cross-process commands/events:
  `docs/architecture/processes-and-protocol.md`.
- Before changing grouped choices, read `Grouped choice implementation` in
  `DESIGN.md`. Before changing Desktop Slash dispatch, Plan/Search integration,
  or Groland membership/protocols, read `Desktop capability implementation contracts`
  in `docs/architecture/processes-and-protocol.md`.
- Architecture decisions: the applicable records under `docs/adr/`.
- Development commands and contribution rules: `CONTRIBUTING.md`.
- Validation routing and runner configuration: `docs/testing/ci.md`; coverage
  scope and performance budgets: `docs/testing/coverage.md` and `docs/testing/performance.md`.
- L2 execution plans: `PLANS.md`. Candidate distribution, R2 updates, and support
  diagnostics: follow the dedicated sections below before those operations.
- Reading only relevant sections does not reduce their authority. Behavior,
  interaction, or token changes must update the corresponding authority document
  in the same change.

## Product boundary

- This repository builds the Pi-first Electron desktop client for Windows x64
  and macOS Apple Silicon.
- `@earendil-works/pi-coding-agent` is the only agent runtime. Do not add a Pi
  RPC adapter, system `pi` fallback, or non-Pi provider adapters.
- Built-in and custom Providers use supported Pi mechanisms and Pi configuration
  as their source of truth; they do not create a second runtime or model router.
- Pi JSONL sessions remain the conversation source of truth. Any application
  index is disposable and rebuildable.
- `pi-gui` and `t3code` are the only comprehensive implementation references.
  Either may inform product, interaction, UI, design, architecture, Harness,
  runtime lifecycle, recovery, tests, and engineering quality. Neither is a
  merge upstream or overrides Pi-67 product and security contracts.

## New Money service and memory boundary

- New Money Desktop and `newmoney.52671314.xyz` form one product. The sibling
  `/Users/gaoqian/Documents/sixseven/codeproject/new-money-server` owns accounts,
  teams, project membership, entitlements and versioned shared knowledge in VPS
  PostgreSQL. Do not import sibling source or make it a filesystem build dependency.
- Desktop owns the local OpenViking runtime and private profile. The service must
  not host OpenViking or receive private memory implicitly. No local PostgreSQL is
  required. Model processing uses explicitly configured user-paid providers.
- Read `docs/adr/0002-new-money-local-memory.md` before modifying memory, team
  synchronization, session provenance or hosted authorization. Its accepted target
  is not evidence that the runtime has already passed migration and packaged tests.
- Team/project content must never be automatically captured into private memory.
  Revoked team sessions retain read-only history; replay, fork and model processing
  require current authorization. Local file copies cannot be remotely recalled.

## Harness contract

- Treat Pi as the only harness and agentic-loop authority. Use supported Pi SDK,
  ResourceLoader, Extension, Tool, and Provider seams; do not introduce a second
  prompt composer, agent loop, Tool orchestrator, model router, or Session truth.
- Keep Desktop-added system context bounded, purpose-specific, reviewable, and
  injected through supported Pi seams. Preserve Pi resource precedence and
  user-owned `SYSTEM.md`, `APPEND_SYSTEM.md`, `AGENTS.md`, Skills, and Prompts.
- The model chooses when and how to request an available Tool. Desktop owns exact
  Tool identity/schema exposure, authorization, execution lifecycle,
  cancellation/recovery, and truthful Tool Result projection. Safety modes and
  Plan constraints restrict availability or execution; they do not create a
  second workflow planner.
- Keep the selected model, Provider, and protocol explicit and stable for a Turn.
  Do not silently switch or retry through another model, Provider, protocol,
  Extension, MCP service, search path, or runtime unless a narrower product
  contract explicitly requires and exposes that behavior.

## Platform and runtime

- Release only Windows x64 NSIS and macOS arm64 DMG/ZIP artifacts.
- Production renderer assets load through `app://pi67`; do not add an internal
  HTTP server, localhost listener, or business WebSocket.
- Development may use Vite on `127.0.0.1` for assets and HMR only.
- Pi runs inside the Electron Agent Host utility process. The renderer must not
  import Electron, Node, the Pi SDK, or filesystem APIs.
- Keep `contextIsolation`, renderer sandboxing, strict CSP, and the narrow
  preload bridge enabled.

## Architecture

- `packages/domain` owns dependency-free policy and state machines.
- `packages/protocol` owns validated cross-process commands and events.
- `packages/extension-compat` owns declarative Extension Adapter manifests,
  SemVer/provenance validation, and the immutable registry. It must not load or
  execute Extension code, import the Pi SDK, or render UI.
- `packages/pi-runtime` owns the `AgentRuntime` port, `PiSdkRuntime`, and the
  extension UI bridge.
- `apps/agent-host` owns the utility-process command router and recovery state.
- `apps/desktop` owns Electron Main, Preload, Repository/Worktree/Git policy,
  durable Desktop state, windows, updates, dialogs, and process lifecycle.
- `apps/renderer` owns React product UI and design-system implementation.
- `eng/` owns development, quality, packaging, performance, capability
  preparation, and release tooling. Generated evidence remains ignored output.
- Do not create generic `utils`, `helpers`, `common`, `misc`, `temp`, `new`, or
  `final` directories. Shared code needs two real callers.

## Repository and worktree hygiene

- This section governs developer/agent Git worktrees used to isolate changes to
  this repository. It does not constrain or authorize Pi-67's user-facing
  app-owned Repository/Worktree environments or their test fixtures; those
  follow `docs/architecture/worktree-product-model.md`.
- `/Users/gaoqian/Documents/sixseven/codeproject/pi-67-desktop` is the canonical
  local development checkout. Continue routine work directly in this root
  checkout; do not create another clone, repository, copied project directory,
  or sibling worktree merely to obtain a clean baseline or run work in parallel.
- A temporary `git worktree` is an exception, not a default workflow. Use one
  only when a prescribed exact-SHA candidate/recovery flow requires isolation,
  or when verified conflicting WIP makes the root checkout unsafe to modify,
  and only with explicit current user authorization and a bounded cleanup plan.
- Keep at most one active temporary task worktree. Create it with Git worktree
  commands rather than a raw directory copy, never treat it as a second
  repository or permanent backup, and keep the canonical root checkout as the
  intended final workspace.
- When the isolated task ends, preserve, integrate, or discard older WIP only as
  authorized; then remove the registered worktree with `git worktree remove`,
  clean up its temporary branch after reachability verification, and confirm
  that only the canonical root checkout remains.

## Execution plans and lightweight development workflow

- For an authorized implementation or fix, continue through the scoped changes,
  relevant validation, and correction of failures caused by those changes. Do not
  stop at a first implementation or ask again for local steps already authorized.
  Pause dependent work only for a material decision that live evidence cannot
  resolve, a genuine blocker, or a step beyond current authorization; continue
  independent authorized work. This does not turn advice/review into implementation
  or authorize commit, push, distribution, or publishing.
- Follow `CONTRIBUTING.md` validation routing and stopping conditions: do not repeat
  passed checks with unchanged inputs unless a gate, new failure, or unresolved
  concern requires it. Report actual results and unverified acceptance items.
- L0 and L1 work stays in the current CLI context and Git diff. Do not create a
  persistent task runtime, task pointer, journal, or generated workflow artifact
  for routine work.
- L2 work uses one execution plan under `docs/plans/` following `PLANS.md`. Keep
  the plan focused on durable decisions, checkpoints, evidence, rollback, and
  the explicit delivery boundary; do not copy raw conversation history into it.
- Implementation is native-first: the current CLI or its native sub-agents own
  implementation. Use an independent reviewer only when risk or the user asks
  for one, and never let a reviewer edit concurrently with the main session.
- Switching Codex, Claude Code, Pi, or Grok is sequential. Before handoff,
  record a bounded checkpoint in the active execution plan or an explicitly
  requested handoff: goal, Git/dirty scope, decisions, validation, risks, and
  next action. The receiving CLI must re-check live Git and runtime state.
- Git, current files, tests, packaged artifacts, and target-platform evidence
  remain authoritative. Plans, handoffs, AI memories, and reviewer reports are
  supplemental and never become product runtime, Session, release, or Git truth.
- Do not install or regenerate a repository-wide workflow scaffold merely to
  coordinate one developer or an occasional cross-CLI review. Reintroducing one
  requires a demonstrated recurring handoff problem and explicit user approval.

## Security and privacy

The Workspace trust, AUTO/ASK/PLAN/YOLO, and installed-capability grants below
describe Pi-67 product behavior to implement and preserve. They do not authorize
the coding agent developing this repository to upload, publish, or operate
external systems. Development operations remain subject to the current user's
authorization and the repository's separate operation and distribution rules.

- Never log or persist API keys, OAuth tokens, cookies, credential payloads,
  prompts, source bodies, or raw tool payloads by default.
- Project trust controls project resources. It is distinct from one-shot tool
  approval.
- New trusted Workspaces default to `balanced`: bounded Workspace reads/writes,
  canonical built-in `write`/`edit` calls outside system and credential paths,
  current-Session loaded-resource reads, verified read-only web Tools, and
  conservatively classified local checks, common project scripts, Workspace-local
  dependency changes, and non-destructive local Git operations may run without a duplicate dialog. An
  enabled Package or MCP capability whose installed content is admitted and whose
  effective Tool identity resolves uniquely is also an AUTO authorization grant,
  including its system, external-path, upload, authentication, publish, dependency,
  or remote side effects. In AUTO, recognized file, persistent-state,
  external-object, Shell, and destructive-Git deletion remains an exact one-shot
  confirmation. Trusted YOLO automatically executes every valid registered Tool,
  including recognized destructive operations; it does not make an invalid identity,
  schema, route, or target valid. ASK remains one-shot; PLAN remains read-only. Unknown, duplicate,
  malformed, drifted, or non-approvable capabilities fail closed instead of
  inheriting a grant. AUTO Shell syntax that cannot be classified safely returns a
  corrective Tool Result without opening a meaningless approval dialog.
- Extensions cannot inject HTML, JavaScript, or React components into the
  renderer. TUI-only custom UI must fail explicitly instead of hanging.
- In AUTO, recognized irreversible destructive actions always require an explicit
  exact one-shot confirmation. Other external, system, credential, or externally
  visible actions outside an exact installed-capability AUTO grant require one-shot approval. Loaded
  resources alone never create that grant: the only Workspace-external read
  exception is the canonical file or Skill directory already loaded by that exact
  Session's Pi `ResourceLoader`; it never grants arbitrary home-directory reads.
  Routine built-in file writes are admitted by their own canonical target and
  side-effect classification rather than by loaded-resource or path-trust state.

## Candidate distribution

- Before candidate preparation, distribution, replacement, or local artifact
  cleanup, read `docs/release/internal-candidate-distribution.md` in full and
  follow its operation and retention contracts. It is the canonical daily flow:
  source-only Git, exact-SHA builds, packaged smoke, three versioned Feishu
  product files, and target-OS manual testing. Stop there by default.
- Feishu is an internal distribution mirror, not the artifact identity
  authority. Bind every test result to the source SHA, workflow run/attempt when
  applicable, candidate identity, size, and SHA-256 recorded by the build.
- Uploads, remote candidate deletion, promotion, and publishing each require
  explicit current authorization. Do not remove the previous candidate until
  the replacement set is uploaded and verified, and cleanup is authorized.
- Before an explicitly authorized unsigned in-app R2 update, read
  `docs/release/internal-r2-update-distribution.md` in full. Feishu candidate success
  does not authorize R2 artifact or manifest publication, retention deletion,
  cache purge, withdrawal, promotion, Tag, or GitHub Release.

## Support diagnostics operation

- Before support credential setup, private-report diagnosis, or reader changes,
  read `docs/release/support-diagnostics-operator-read.md` in full. Use the local
  exact-key reader as the routine path; browser/dashboard access is a separately
  justified fallback. Keep credentials outside Git and never expose their values.
- Creating/revoking the read-only token and exact reads of user-supplied reports
  require current operator authorization. Listing, writes, deletes, retention,
  Worker deployment, and update-bucket operations remain distinct external
  actions and are never implied by read authorization.

## Validation routing

- Start with affected-package typecheck/tests and the exact boundary gate.
- `corepack pnpm run check` is the aggregate source-quality gate for cross-module,
  high-risk, candidate/release, or unclear-impact changes; it is not packaged or
  target-OS evidence.
- Extension Adapter manifest, registry, or provenance changes additionally
  require `corepack pnpm run verify:extension-adapters`.

## Design and quality

- `PRODUCT.md` owns product intent. `DESIGN.md` and `DESIGN.dark.md` own visual
  and interaction authority. Update them with behavior or token changes.
- Use TypeScript 7 strict mode, exact dependency versions, and the frozen pnpm
  lockfile.
- Keep streaming batched, transcripts virtualized, and async work cancellable.
- Add targeted tests for protocol, policy, Pi SDK, recovery, and visible UI
  changes. Do not infer runtime quality from source alone.
- Windows claims require real Windows evidence; macOS claims require real
  Apple Silicon evidence. Browser previews do not prove packaged Electron
  behavior.
- On macOS Apple Silicon, after a completed user-visible change set passes its
  relevant gates, run `corepack pnpm run preview:mac:unsigned` by default unless
  the user asks not to relaunch. This must quit the old preview, package, smoke,
  and open the repository artifact; `open` alone is not proof that new renderer
  assets were loaded.
- Never commit build output, installers, logs, databases, screenshots, traces,
  sessions, or credentials.
- `commit` does not mean `push`; publishing, signing, GitHub releases, and
  external actions require explicit current authorization.
