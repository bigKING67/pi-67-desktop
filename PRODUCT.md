# Product Context

## Register

Developer product and local-first cross-platform desktop application.

## Platforms

- Windows 10 22H2 and Windows 11, x64 only.
- macOS 12 or newer, Apple Silicon arm64 only.

## Users

- Primary: beginner and intermediate Pi users who want a clear graphical path
  from workspace selection to a completed coding task.
- Secondary: experienced Pi and pi-67 users who expect their existing
  `~/.pi/agent` configuration, sessions, models, skills, prompts, extensions,
  and TUI workflows to remain interoperable.

## Purpose

Use the real Pi SDK through a calm desktop workspace while preserving Pi's
session, configuration, resource, model, and extension contracts.

## Positioning

`π` is the user-visible graphical surface for Pi/pi-67. `Pi-67 Desktop` remains
the technical release, package, application ID, protocol, and artifact identity.
The product is not a second agent,
a provider marketplace, an RPC wrapper, or a full IDE. It favors truthful
state, fast interaction, safe recovery, and Pi compatibility over feature
count.

## Reference policy

Pi-67 only follows `pi-gui` and `t3code` as comprehensive implementation
references. Either may inform product behavior, interaction, UI, design,
architecture, Harness, runtime lifecycle, recovery, tests, and engineering
quality. `pi-gui` is the current primary baseline, not an exclusive authority,
and `t3code` is not limited to Harness concerns. Reference observations do not
automatically enter the roadmap or override this product contract. Pi remains
the only Runtime and behavior specification source.

## Product vocabulary

- `对话` is the user-visible, long-lived navigation object that may be renamed,
  pinned, or archived.
- `任务` is one execution instance and owns running, waiting, completed, failed,
  cancelled, lost, and stopped lifecycle states.
- `Session` is reserved for Pi JSONL, Protocol, diagnostics, import, tree, and
  other technical contexts. User-facing organization actions do not call a
  conversation a Task or Session.

## Primary jobs

1. Register one or more workspaces and switch conversations from one grouped
   navigation rail. A running task binds exactly one workspace, one managed Pi
   JSONL session, and one live Pi Runtime, and continues in the background when
   another conversation is selected.
2. Manage Pi Providers, models, default selections, and credentials from
   Settings. Credentials persist to Pi `auth.json` by default; an explicit
   runtime-only key remains available for temporary use.
3. Follow streaming reasoning, tools, intermediate results, file changes, and
   follow-up work without losing the current task. One turn owns one execution
   process: visible reasoning stays readable in sequence, each Tool Call and its
   Tool Result form one inspectable step, and the final answer remains outside the
   process as the primary result. The process stays expanded while work is active,
   collapses only after successful completion has a visible final answer, and
   remains fully inspectable on demand. Failure, cancellation, loss, or a missing
   final answer keeps the process expanded for diagnosis.
4. Use skills, prompts, extension commands, session tree, rollback, and compact
   from a coherent graphical interface.
5. Diagnose shell, configuration, extension, update, and runtime failures
   without exposing credentials or private content.
6. Move sequentially between Desktop and Pi TUI using the same Pi JSONL session.
7. Open the singleton Settings surface across Application, Pi, Office,
   Capabilities & Integrations, and System & Support categories without losing
   drafts or background work.
8. Install and operate Pi Extensions, Skills, Prompts, and Rules; configure
   external MCP services; and prepare supported browser integrations without
   requiring a system Node, npm, Git, pnpm, or Pi CLI.

## Success criteria

- Both supported platforms can install, launch, and complete an offline SDK
  contract smoke from signed packages.
- Existing users reuse `~/.pi/agent` without credential or session migration.
- Every Desktop Pi turn receives the device-local calendar date and time zone in
  a bounded, non-persisted environment context. Relative terms such as `today`,
  `tomorrow`, `this week`, and `recent` use that local calendar; volatile claims
  still require available Tool evidence rather than dates inferred from retrieved
  documents.
- Windows x64 and macOS arm64 packages include pinned private Node, npm, and Git
  toolchains. Package operations fail closed when the bundled toolchain is
  missing or invalid and never fall back to unverified system executables.
- Networked Package check/install/update/uninstall operations run in one
  Agent-Host-owned isolated worker per request. The worker receives an explicit
  operating-system/toolchain environment allowlist rather than the Host environment,
  returns at most 1 MiB of validated IPC data, and discards stdout/stderr. Host
  shutdown rejects new Package work, terminates every active worker process tree in
  two bounded phases, and waits for observed exit before reporting graceful cleanup.
  POSIX uses a dedicated process group; Windows uses tree-aware `taskkill`, whose
  final release evidence still requires real Windows validation. Windows does not
  yet use a Job Object; when a dead root PID leaves descendant cleanup unprovable,
  shutdown fails closed instead of reporting graceful cleanup.
- Desktop-owned install/update/uninstall mutations use a private durable receipt
  keyed by digests of the owner, source, idempotency key, and mutation fingerprint.
  The receipt never stores a raw source URL/path, install path, Workspace path,
  credential, Prompt, source body, stdout, stderr, or package file inventory.
  `active` means the worker completed, Main-Host Pi Settings reloaded, the installed
  directory was safely observed, and that observation was durably committed.
  `removed` additionally requires the exact source/scope to be absent after reload.
  Reserved, mutating, or ambiguous receipts are never replayed automatically after
  Host replacement.
- Runtime Package admission is fail closed. Exact verified Desktop capability paths,
  exact Packages matching a cataloged Pi-67 content baseline, and user-installed or
  user-approved Packages whose current directory identity, package name/version,
  manifest hash, and bounded content hash match their admission evidence are exposed
  to Pi's Session Settings view. Approval observes the already-installed bytes and
  never downloads or reinstalls a Package. `known-baseline-observed`,
  `user-approved-observed`, and `user-installed-observed` are bounded admission and
  drift evidence, not npm registry integrity, a signature/provenance proof, a pinned
  Git commit, or process isolation. The bounded content hash excludes `.git`
  and `node_modules`, inspects at most 10,000 files / 128 MiB / depth 32 / five seconds,
  and blocks execution when that inspection is unsafe or incomplete. Package mirrors
  change transport only and never upgrade trust.
- A committed Package receipt proves Settings/content convergence, not that every
  already-live Task reloaded resources. A Task reload failure stays observable after
  the receipt commit; Desktop does not roll back the receipt or rerun the Package
  side effect blindly.
- Package Worker isolation covers check/install/update/uninstall only. Pi SDK 0.83.0
  still imports third-party Extension modules and executes their factory, hooks,
  commands, Tools, Extension UI, and any MCP child launcher inside the Agent Host
  utility process. Desktop must not describe those runtime surfaces as isolated until
  Pi provides an executor/proxy boundary, Desktop maintains an audited loader fork,
  or unsupported third-party execution is explicitly disabled.
- On Windows, Package Worker and Desktop-owned Skill Pack subprocesses enter a
  Main-selected native Job Object before their operation request is delivered.
  `KILL_ON_JOB_CLOSE`, bounded inspection, forced termination, and zero-active-
  process confirmation own descendant cleanup. Failure before attachment blocks
  only that package operation as a toolchain-integrity failure; uncertainty after
  attachment poisons the operation runtime instead of reporting a false success.
  Read-only Git update checks probe every actual installed Git origin and select the
  first configured mirror or official GitHub route that reaches all of them before
  running Pi's update comparison once. npm failures never trigger Git source changes.
  Commit, registry, manifest, and content-integrity failures remain fail closed.
- A Windows/macOS user with no prior Pi TUI Profile and a user who already owns a
  populated Pi TUI Profile are both first-class Desktop users. Both use the same
  canonical Pi Agent Profile and Pi JSONL Sessions; Desktop never selects a second
  Profile or Runtime based on whether a system `pi` executable is installed.
  Startup classifies the Profile as `fresh`, `existing-shared`, or
  `desktop-managed-upgrade` from the directory and a validated Desktop capability
  receipt. A missing, invalid, or legacy receipt without explicit Profile ownership
  never grants Desktop ownership of existing
  user resources. Desktop records `shared` origin when it first materializes its own
  namespace inside an existing Profile, so later capability upgrades do not silently
  reclassify the rest of that Profile as Desktop-owned.
- Pi-67 Core, browser67, design-craft, and the commerce-growth-os Skill suite ship
  as pinned first-party capability snapshots. Build and packaging verify their full
  locked trees. A packaged Agent Host validates bounded metadata and critical
  entrypoints, then loads the read-only snapshot directly from Electron resources;
  it does not hash or copy the full tree into the Pi Agent Profile on every launch.
  The Profile keeps a separate writable managed Overlay root, preserves existing
  Package object filters, namespaces managed Rules, and never overwrites an existing
  global `AGENTS.md`. Legacy copied built-ins are removed only after Host readiness;
  Skill Pack overlays, state, Pi settings, credentials, and JSONL Sessions remain.
- The default Pi Package set stays bounded. In addition to Pi-67 first-party
  capability Packages, Desktop ships the complete locked runtime closures for
  `pi-mcp-adapter@2.11.0` and `pi-observational-memory@3.0.3`; the client never runs
  npm to activate them. Build and packaging verify the complete bundle; packaged
  startup loads it directly from the read-only `bundled` resource while retaining
  only enablement state in the writable Overlay. Development and legacy recovery
  may still use the verified `bundled -> staging -> active` projection. Observational Memory has a
  Desktop-owned durable opt-out state, does not rewrite shared Pi settings, and keeps
  upstream `debugLog=false`; an explicit opt-out UI is not yet a completed surface.
  Other recommended third-party Packages remain user-initiated. `pi-hy-memory`,
  `@ff-labs/pi-fff`, and `@victor-software-house/pi-curated-themes` are retired from
  the default catalog.
- Desktop provisions `tmwd_browser` and `js-reverse` as managed browser67 MCP servers
  in the Pi Agent Profile with the private packaged Node executable. It updates only
  entries carrying a matching Desktop receipt and never runs npm in the packaged
  client. Same-name user-owned entries, invalid JSON, cache conflicts, and
  compare-and-swap conflicts fail closed at the browser67 enhancement boundary:
  Desktop preserves the user bytes, marks Agent Host startup `degraded`, and keeps
  the core Pi runtime available. When the managed browser67 revision or server specification
  changes, Desktop removes only those two entries from valid `mcp-cache.json`, keeps
  unrelated cached servers, and records cache invalidation completion before startup
  proceeds.
- Settings presents Pi's automatically loaded Markdown instructions as `工作规则`
  in explicit `全局` and `项目` scopes. Global and project `AGENTS.md` rules remain
  primary; inherited rules are visible directly in the project scope. Pi-67 built-in
  rules and `SYSTEM.md` / `APPEND_SYSTEM.md` overrides are advanced configuration and
  stay collapsed by default. Only files whose `presence` is `present` count as
  configured; missing canonical files remain explicit creation candidates rather
  than inflating status counts. `提示词模板` is a separate user concept: it joins a
  message only when the user invokes `/名称` and never masquerades as a persistent
  work rule. Every work-rule file opens into a source/preview detail. Pi-67 built-in files and files inherited from outside the Workspace are
  read-only; regular files in the controlled global root or a trusted Workspace are
  editable. Creation is limited to the canonical `AGENTS.md`, `SYSTEM.md`, and
  `APPEND_SYSTEM.md` locations. Existing `CLAUDE.md` variants remain editable where
  controlled, but Desktop does not create them and exposes no arbitrary path,
  rename, or delete operation. Saves compare an opaque content revision, write
  atomically, and reload every initialized Pi Task affected by the global or project
  scope. A reload failure rolls the file back and reloads the restored baseline;
  an external revision conflict preserves the unsaved draft instead of overwriting
  it. Markdown bodies and drafts remain renderer-memory-only and never enter Session
  projection, Workbench persistence, notifications, diagnostics, or default logs.
- Global Skills with an explicit owning updater and verified suite manifest may be
  checked and updated once per Skill Pack. A missing Lark CLI remains a visible
  `not-installed` dependency instead of a generic failed check. After one explicit
  confirmation, Desktop uses its private Node/npm only as the installer, downloads
  `@larksuite/cli@latest` with npm lifecycle scripts disabled, validates the exact
  package identity and bounded official install entry before executing that one entry,
  validates the native executable, reported version, and official update-check JSON,
  then atomically activates it under the current user's shared Agent tools root and
  creates a native user launcher. The same confirmed transaction stages the exact
  catalogued official suite through the pinned `skills` installer, validates its
  bounded trees and source lock, and installs missing members into
  `~/.agents/skills`. Existing same-name Skills are preserved. A later
  Desktop-managed update may replace only members whose lock source is already
  `larksuite/cli`; any unowned or unverifiable member blocks overwrite. This makes
  the official Skills reusable by Pi-67 and other compatible Agents that read the
  standard shared directory. The packaged toolchain and application resources are
  never installation targets; CLI, launcher, global Skill lock, Skill activation,
  and Workspace reload failures restore the previous user state. Runtime resolution
  prefers this Desktop-managed native executable and remains compatible with a
  verified existing user installation. External user installations continue to use
  their owning CLI update path, while Desktop-managed installations update through
  a newly staged and validated atomic replacement. A complete official Skill set
  already at the latest reported Skill version remains updateable when only the CLI
  version is behind; incomplete or otherwise unverified Skill drift blocks overwrite.
  Pi resources reload only after the updater verifies convergence. Settings reports
  the current CLI, official Skills, and latest stable version separately.
  AI Berkshire uses the Pi-67 Skill Pack registry instead: Desktop resolves one
  exact Pi-67 `main` commit, validates the bounded registry/lock and every declared
  Skill hash, installs only those Skills as a separate Pi Package Overlay, activates
  it atomically, and rolls back if any Workspace resource reload fails. The immutable
  bundled baseline remains available through `恢复内置版本`. A legacy
  `bundled-release-only` record with no installable upstream may prove only that an
  older non-installable registry version exists; it can never stage an Overlay.
  After an explicit check, Settings shows the effective version, the compatible or
  historical registry version, and a distinct current/update/non-installable/error
  result; the `全局可用` scope label never substitutes for update-check evidence.
  Loose global Skills remain user-maintained, project Skills remain project-owned,
  and Package Skills update with their Package. Bundled Skills always retain an
  immutable Desktop baseline; a suite may additionally use a verified managed
  overlay between Desktop releases only when its updater, compatibility contract,
  content hashes, atomic activation, and rollback path are explicit.
  Settings presents these as two availability scopes rather than mixing scope and
  provenance: `全局可用` groups Desktop-bundled, updater-managed, and user-local
  Skills, while `项目专属` contains only the current project's own Skills. Every
  bundled suite remains available to all projects even when its release and update
  lifecycle differs from a user-installed global Skill.
- Bundled Skill suite versions come from the content owner rather than the Package
  that happens to carry them. AI Berkshire reads its version plus source commit
  provenance from the Pi-67 Skill Pack registry/lock and records
  `https://github.com/xbtlin/ai-berkshire` as its upstream. Desktop pins the exact
  upstream commit plus the expected Pack version, manifest hash, and bundle hash;
  its build uses the adapter from the locked Pi-67 Core source and fails closed if
  regenerating the Pack does not reproduce those values. This lets a Desktop release
  refresh the bundled AI Berkshire baseline without relabeling Pi-67 Core or waiting
  for a new Core release. Commerce and browser67 use their locked capability versions.
  Multi-source design suites have no invented aggregate version, and Lark's bundled
  copy remains explicitly unversioned until its build provenance supplies a
  verifiable suite version.
- Settings owns one global `办公 -> 飞书` surface with `用户授权` and `应用配置`
  page-level tabs. `用户授权` is first and selected by default because the user's
  personal identity is the primary office task. Both tabs first expose a missing
  Lark CLI as an explicit prerequisite with `安装 Lark CLI` and `前往技能` actions;
  the confirmation explicitly identifies a current-user global installation and
  `~/.agents/skills` sharing scope. Application editing and user login stay disabled
  until that installation verifies.
  The Device Flow still depends on a verified App identity; when one is missing, the
  user tab explains that dependency and links directly to `应用配置` instead of
  exposing both workflows in one long page. App ID remains visible, while a newly entered App Secret may be revealed only
  in the active editor and crosses a dedicated one-shot credential command to Agent
  Host. Agent Host passes it to the resolved user-owned `lark-cli` through stdin, never argv,
  and clears its mutable input buffer after the bounded configuration attempt. Saved
  App Secrets are not read back or duplicated by Desktop; organization-managed
  application sources remain read-only when such provenance becomes available.
  `用户授权` invokes the `lark-cli` Device Flow, Renderer opens only the validated HTTPS verification URL,
  and the resulting user OAuth identity is used for personal Drive, Calendar, IM,
  Task, Mail, and other user-authorized resources. Bot identity never uses the user
  OAuth login action and cannot stand in for the user's personal identity. User
  tokens remain owned by `lark-cli`; Device Code remains Agent-Host-memory-only.
  Tokens, Device Code, saved App Secret, open_id, and full scope lists never enter
  Pi JSONL, Desktop persistence, diagnostics, default logs, or model context. A
  ready identity status proves only the bounded CLI verification, not that a
  particular Feishu business API operation has succeeded. User access-token expiry
  is not authorization expiry: `needs_refresh` remains usable and is described as
  automatic renewal on the next user API call; only an invalid or expired refresh
  grant requires a new browser authorization.
- Visual assistance and browser capability readiness are the first-party tasks under
  Settings' Capabilities & Integrations group. The separate Office group owns Lark identity;
  it is not a generic MCP endpoint or credential editor.
  `浏览器集成` owns browser-specific dependency preparation and runtime diagnostics.
  Pi user-owned MCP configuration remains visible through normal Runtime capability
  projections, but Desktop does not provide a generic MCP endpoint or credential editor.
- The former Desktop-owned Team MCP/Tavily Bridge product is retired. Desktop no
  longer bundles its resource definition, stores or reveals its token, injects its
  environment, or bootstraps it into Pi. On Desktop startup, Agent Host removes only
  the exact former `tavily-bridge` URL/auth/token-env identity from `mcp.json` through
  an exact-revision atomic replacement. Same-name user-customized entries and every
  unrelated field/server are preserved. Cleanup runs only for a Profile with validated
  Desktop ownership; a concurrent external edit wins and fences that cleanup, not core
  Agent Host startup. Main attempts to
  remove only the former userData token file without following symlinks. Token cleanup
  failure does not block the application because the token is no longer injected.
- Download-source probing validates and checks the current in-memory draft without
  persisting it. Probe results identify whether they belong to unsaved settings and
  become stale as soon as the draft changes; only the explicit Save action writes
  settings. Restoring defaults is a separate confirmed destructive action.
- Bundled browser67 source and Skills do not imply live browser readiness. The
  product treats bundled source, prepared runtime dependencies, prepared unpacked
  extension files, a browser-loaded extension, and a live identity-matched managed
  connection as distinct facts. `已安装并连接` requires a current-process Doctor
  result whose WS or Link route reports `extension_identity_ok` with
  `identity_match=true`; persisted success from an earlier application process is
  only a prompt to recheck.
- Browser-extension installation is guided rather than silent. After one-shot
  confirmation, Desktop may prepare dependencies and files, then opens a detected
  Chrome or Edge extension page and reveals or copies the validated extension
  directory. The user remains responsible for enabling Developer mode and choosing
  `Load unpacked`; a second one-shot confirmation may start or reuse the local Hub
  before live identity verification. Desktop never installs through browser policy,
  mutates a browser profile, or treats copied files as proof that Chrome/Edge loaded them.
- One Electron window can register multiple workspaces. The navigation rail is
  the only Workspace and conversation switcher: each Workspace is a collapsible
  group containing active work, drafts, and Catalog-backed recent sessions.
- Session history has no user-visible open-tab limit. Catalog pages, search, and
  list virtualization keep large histories bounded, while Pi JSONL remains the
  source of truth. Each group initially shows six ordinary recent sessions and
  offers an explicit load-more action.
- A conversation title resolves in one order everywhere: explicit Pi
  `session_info.name`, otherwise the most recent topical user message on the
  current Pi branch, otherwise `未命名对话`. Follow-ups such as `继续吧`, bare
  confirmation, commit/push acknowledgements, and standalone navigation Slash
  commands do not replace an earlier useful topic. Automatic titles are derived
  locally without a model call and are never written into SQLite, Workbench
  persistence, logs, diagnostics, or telemetry.
- Explicit rename remains stable across later prompts. `恢复自动标题` appends an
  empty Pi `session_info` name and returns the conversation to the branch-derived
  title contract. A live Task uses Task authority for the mutation; a cold
  Catalog row uses Workspace authority and never creates a hidden Runtime.
- The application admits at most eight top-level Session tasks (`MAX_RUNNING_TASKS = 8`) in accepted,
  running, approval-wait, or Extension-input-wait states. Subagents launched
  inside a Task do not consume additional top-level admission slots. The Renderer
  explains the limit early, but the Pi runtime service owns the atomic admission
  decision.
- Each live task owns an independent Pi Runtime and projection. Selecting another
  conversation, collapsing a Workspace, or opening Settings does not stop
  background work. One physical Pi JSONL file has at most one live writer across
  the application and overlapping Agent Host replacement windows, including
  hard-link and canonical-path aliases. A pending path is rekeyed to physical file
  identity before its provisional fence is released. Normal Task close or Host
  shutdown releases the cross-process lease only after Pi Runtime disposal succeeds;
  an unprovable or compromised lease forces Host replacement instead of reopening.
- A conversation row menu owns `置顶对话` / `取消置顶`, `重命名对话`, optional
  `恢复自动标题`, and `归档对话`. Only a genuinely accepted, running, or waiting
  Task exposes `停止任务`; idle and terminal Tasks do not present a false stop
  action.
- Archive is organization, not deletion. It never moves, rewrites, or deletes Pi
  JSONL and there is no permanent-delete action. Active, initializing,
  provisional, or unsent-draft conversations cannot be archived. Archiving an
  idle loaded conversation disposes its Runtime first, automatically removes its
  pin, returns a selected row to its Workspace surface, and offers one memory-only
  Undo action. The paged `已归档对话` view supports search, restore, and restore-and-open;
  a restored conversation returns as ordinary unpinned history.
- A workspace added through the native directory picker is trusted for project
  resource loading. Project trust and the current Task Runtime's Tool execution
  mode remain distinct: trust is a prerequisite for `YOLO`, not an implicit
  request to enable it.
- Workspace registration persists the native canonical path, lossless filesystem
  identity when available, and the last successful verification time. Startup
  restores trust only when the physical directory identity still matches. A
  missing or temporarily unreachable directory remains offline, a different
  physical directory at the same path loses inherited trust, and path-only
  evidence requires explicit native-picker confirmation. Selecting a relocated
  directory is an explicit rebind; Desktop does not scan unrelated user folders
  to guess where it moved.
- Every Task Runtime created through the current Desktop default starts in
  `AUTO`; an explicit legacy `guided` initialization maps to `ASK` rather than
  silently broadening its former policy. The mode is memory-only, belongs to
  that exact Task Runtime, is not written to Workbench state, Pi settings, or
  Session JSONL, and resets to the current default after Task stop, Runtime
  disposal, application restart, or Workspace trust revocation. Switching Tasks
  shows each live Runtime's independent mode.
- `ASK` automatically permits canonical Workspace reads, current-Session loaded
  resource reads, capability inspection, and verified read-only web operations;
  configured operations, persistent writes, Workspace writes and commands, and
  higher-risk effects request a one-shot decision. `AUTO` additionally permits
  canonical Workspace writes, bounded local inspection/test/build commands,
  ordinary operations from the Task's effective configured Package or MCP
  sources, and non-destructive persistent-state writes. `YOLO` permits every
  registered Tool in that trusted Task Runtime, including workspace-external,
  destructive, system, and network-side-effect calls.
- AUTO trusts an effective configured source, not an arbitrary registered Tool
  name. At Session resource load, Desktop builds a bounded in-memory capability
  catalog from the effective Task-local Package settings plus that Task's valid
  `mcp.json` and `mcp-cache.json`. The catalog retains only Package/server/Tool
  identity, MCP transport, direct-Tool mapping, and schema digest; it excludes
  command, args, environment, URL, credential, Tool input, and Tool result data.
  Resource reload atomically rebuilds the catalog, while the Tool Call hot path
  performs only in-memory lookups. Duplicate Package, server, nested Tool, or
  Direct Tool identities remain fail-closed.
- Bounded Workspace reads and writes, conservatively classified local
  inspection/test/build commands, and exact read access to the Skills, Prompt
  files, context files, and visible Extension files already loaded by that
  Session may run according to the selected mode without duplicate dialogs.
  Loaded Skill directories grant only read/search/list access within the
  canonical directory; other loaded resources grant only exact-file read/search,
  never write or symlink escape. Pi-67 registers `web_search`, `source_check`,
  HTTP(S) `fetch_content`, and bounded `get_search_content` as first-party Pi SDK
  `customTools`; they are not Extension Packages. `web_search` and
  `source_check` require the selected model's declared protocol-native route.
  A model without such a route fails as unavailable before any search request is
  sent. Authentication, quota, rate-limit, server, malformed, oversized, and
  empty-result failures remain visible; Pi-67 never switches Provider or silently
  resends the query through an Extension or third-party search service.
  `fetch_content` rejects URL credentials, non-public DNS
  results, unsafe redirects, and responses over 2 MiB. Successful search or fetch
  results receive an in-memory bounded `responseId` for `get_search_content`; the
  reference neither performs a second network request nor broadens Tool authority.
  External paths, persistent-state deletion, upload or external submit, authentication or
  credential actions, dependency changes, destructive commands, publishing,
  remote Git, system changes, and external writes retain one-shot approval in
  AUTO. Calls that approval cannot make valid -- including unregistered or
  ambiguous Tools, reserved Tool identity mismatches, malformed MCP routing, and
  unverifiable opaque cursors -- are rejected with a corrective message and no
  approval dialog. The retired `@ff-labs/pi-fff@0.10.1` is not installed or
  recommended by Desktop; if a user explicitly installs and admits that legacy
  Package, its `grep`/`find` and `ffgrep`/`fffind` calls inherit this
  path policy only when their Package identity and input contract are exact:
  when pi-fff runs in `override` mode, `grep` and `find` are the FFF-backed live
  names rather than native fallbacks, and Desktop tells the model to use and
  describe those exact names accordingly. In the default named mode the live
  names remain `ffgrep` and `fffind`.
  Workspace-local roots run normally, workspace-external and symlink-escaped
  roots expose the canonical path for one-shot approval, and opaque pagination
  cursors fail closed outside `YOLO` because their original root cannot be
  proven.
- While the verified managed `pi67-core` Package is active, the Task-local Pi
  settings view force-excludes the first-party legacy auto-discovered
  `pi-rules-loader` copy under `~/.pi/agent/extensions`. The legacy file and user
  settings are not deleted or rewritten; the managed Package becomes the single
  runtime source. `pi-vision-bridge` and `xtalpi-pi-tools` are no longer managed,
  bundled, or force-excluded by Desktop. If managed `pi67-core` is absent,
  Desktop applies no exclusion. This prevents duplicate rule notifications and
  duplicate-source ambiguity without taking ownership of unrelated user
  Extensions. Individual Tool capabilities still follow their own Safety
  Profile; deduplication does not grant authority by itself.
- Verified `pi-mcp-adapter@2.10.0` and `2.11.0` metadata operations remain a
  read-only capability: status, cached server Tool lists, bounded
  search/describe, and current-Session UI-message inspection run in `ASK` and
  `AUTO`. In AUTO, connecting a server already present in effective `mcp.json`
  and invoking a nested Tool present in the effective cache follow that Tool's
  actual side-effect classification; ASK still requests a one-shot decision for
  connect and configured operations. Adding a server, OAuth/authentication,
  credential changes, or permission expansion remains a confirmation boundary.
  An unconfigured server, missing or ambiguous nested Tool, malformed proxy args,
  unsupported Package identity, or duplicate `mcp` source is rejected without a
  meaningless approval. A proxy call
  that mistakenly addresses a current, explicitly user-installed and admitted direct
  `pi-fff` Tool is not an
  authorization decision: Desktop rejects it without opening Approval and tells
  the model to use the active direct name (`find`/`grep` in override mode or
  `fffind`/`ffgrep` in named mode). The corrected Workspace-local read then follows
  the normal `ASK`/`AUTO` path policy.
- Configured Memory reads and search/list/recall operations are read-only;
  remember/add/learn/propose/flush are non-destructive persistent writes and run
  in AUTO; forget/delete/purge remain one-shot decisions. Configured browser
  passive inspection, extraction, wait, screenshot, and download operations run
  in AUTO subject to canonical path checks, while JavaScript execution, native
  input, clipboard mutation, upload, and authentication remain higher-risk.
  Task-scoped JS-Reverse instrumentation, including hook removal and finalization,
  is a configured operation rather than persistent user-data deletion.
- Restored Workspace registrations are checked against their persisted filesystem
  identity before project resources load. A missing or replaced directory stays
  inactive until the user explicitly repairs it through the native directory
  picker; repairing it is a fresh trust gesture.
- Repository inspection is an independent, read-only Electron Main capability.
  It resolves the registered Workspace through the pinned private Git toolchain,
  groups primary and linked Worktrees by physical Git common-directory identity,
  and exposes only opaque Repository/Worktree IDs plus bounded branch, HEAD, and
  state observations. A non-Git directory, missing private Git, timeout, corrupt
  disposable Worktree Catalog, or stale inspection never blocks ordinary Workspace
  registration, Session Catalog access, Session creation, or Prompt submission.
  The Catalog can be deleted and rebuilt from Git; raw paths, Git output, private
  executable paths, prompts, and source bodies do not cross to the Renderer or enter
  the projection. Inspection itself exposes no arbitrary Git action or argument surface.
- A provisional conversation defaults to `当前工作区` and may select
  `隔离 Worktree` only from a fresh, ready Repository observation whose current
  Worktree has an exact HEAD. Selecting either environment is Renderer state
  only and never mutates Git. The provisional draft and environment intent are
  checkpointed together, so restarting the application does not silently fall
  back to another environment. Non-Git, stale, missing, untrusted, toolchain-
  unavailable, binding-error, and creation-recovery states remain explicit and
  keep the Worktree option disabled without blocking ordinary Local Sessions.
- The first Prompt from a Worktree intent starts one caller-stable, Main-owned
  creation transaction: private Git materialization, native Workspace
  registration, Host registration, Pi JSONL Session materialization, exact
  Session binding, and commit. Workbench V5 durably records environment bindings
  and mutation recovery while the disposable Catalog remains rebuildable.
  Unknown results preserve the Worktree and resume by exact creation identity;
  repeated clicks or recovery never create another branch, Worktree, or Session.
  Automatic cleanup is limited to an exact, clean, profile-owned artifact while
  the durable record is still `workspace-registered`, no Host/Session recovery
  authority exists, and Main writes `rollbackSafety = pre-host-confirmed` before
  cleanup. Later, dirty, mismatched, locked, prunable, or uncertain outcomes are
  retained and fence Repository mutations. Worktree removal and force actions
  are not exposed in this phase.
- Settings opens or focuses one application-level selected surface. Global and project
  scope are explicit only where meaningful, and changing the current workspace
  retargets project scope instead of creating another Settings instance.
- Settings navigation groups `账户` and `外观` under Application; Pi resources
  under Pi; `飞书` under Office; visual assistance and browser work under
  Capabilities & Integrations;
  and runtime, network, updates, and About under System & Support. Category
  search searches these navigation targets rather than arbitrary page content.
  Narrow windows use the same grouped information architecture in a bounded
  popover.
- `恢复与诊断` combines three read-only authorities without creating another
  business source of truth: Pi runtime checks from `doctor.run`, bounded Agent
  Host recovery facts from `diagnostics.collect`, and Electron Main Workspace,
  previous-run exit, pending-creation, and attachment-staging facts. The exit
  projection distinguishes first launch, clean exit, unclean exit, and an
  unreadable/unknown prior state; first launch is not reported as a crash. Failure on one side
  keeps the other results visible. Running checks does not create, reopen, replay,
  delete, move, or repair a Session, Workspace, lease, Catalog, or attachment.
- Diagnostic export accepts only a schema-validated request at the Main boundary.
  Agent Host `RuntimeDiagnostics` is optional: a three-second acknowledgement
  budget preserves it when available, while timeout, disconnection, or Host
  replacement still exports Main-owned recovery, Supervisor lifecycle, and Pi
  configuration readability metadata. Main writes `pi67-support-diagnostics.v5`,
  which adds bounded Profile mode, startup ready/degraded state, total and per-stage
  startup duration, capability projection mode, startup issue, Main service health,
  and Renderer acknowledgement latency;
  Renderer cannot submit arbitrary JSON or raw error text. The support file
  contains hashes, categories, counts, revisions, states, bounded timestamps,
  and bounded error classes, never raw Workspace or Agent Directory paths,
  configuration bodies, prompts, source bodies, credentials, environment values,
  stdout/stderr, or Tool payloads.
  Alpha exposes only recheck and export actions here; it has no clear-all,
  force-unlock, automatic replay, or unverified repair action.
- Provider, Download Sources/Network, and Rules/Context drafts stay
  in Renderer memory. Leaving the category, changing an applicable page scope, or
  returning to the Workbench requires an explicit discard decision while dirty.
  Removing a custom Provider definition, restoring default download sources,
  or removing a persistent Provider credential requires a
  separate confirmation whose default action is Cancel.
- The conversation workbench is the only three-region application surface.
  Settings and other application-level surfaces replace the Workspace rail with
  their own bounded navigation, use a two-column shell on wide windows, and
  provide an explicit `返回工作台` action that restores the prior conversation or
  Workspace without stopping background tasks.
- The footer shows a signed-out account entry and a help menu. Account opens the
  Settings account section; local Pi, Workspace, and Session use does not require
  login. Enterprise and team capabilities remain unavailable until a real
  account service is integrated.
- The user-visible application name and icon are `π` with the locked black-square
  and white-mark assets. `com.pi67.desktop`, the `pi67` URL scheme, package names,
  GitHub repository, executable names, and `Pi-67-Desktop-*` release artifacts
  remain stable technical identities.
- Desktop-created and TUI-created sessions can be resumed sequentially in the
  other interface.
- Importing external JSONL keeps the selected source unchanged, creates a
  collision-safe managed copy in the current workspace session directory, and
  resumes that copy with the current workspace as its effective cwd.
- Common Pi extension UI primitives work; TUI-only UI is identified explicitly.
- The Extension Catalog hides Desktop-internal policy extensions and reports
  command, tool, shared UI, and TUI-only surfaces. Package-attributed Adapter
  compatibility requires Pi-resolved package manifest evidence, canonical installed
  SemVer, Registry version matching, and final runtime surface ownership; it never
  implies shared `ctx.ui` caller attribution.
- A verified Adapter may additionally declare the `delegated` presentation for a
  Tool whose package, version, source, and runtime surface all match. This is a
  presentation fact, not a typed child-agent roster: Pi-67 does not infer or display
  child identity, model, token/cost, tree position, parallel count, or child result.
  Generic same-name Tools never receive that upgrade.
- `npm:@narumitw/pi-plan-mode`, `npm:pi-web-access`, and `npm:pi-smart-fetch`
  are replaced by first-party Plan/Search capabilities. Existing Pi user settings
  are not deleted or rewritten, but Desktop Tasks do not load those Packages and
  Settings identifies the native replacement before an explicit user uninstall.
  This retirement does not close the third-party Pi Package ecosystem.
- Production starts no local HTTP server and listens on no application TCP port.
- Welcome does not start the internal Agent Host utility process or load the Pi
  SDK until a Workspace or Pi-runtime diagnostic action needs it.
- Credential, prompt, source, and raw tool content never enters telemetry or
  default diagnostic logs.
- Provider status snapshots expose only non-secret metadata such as configured
  state, credential source, and model count. A complete credential may cross to
  the renderer only in the result of an explicit one-shot reveal request for a
  literal API key stored in Pi `auth.json`; it never enters snapshots, events,
  projections, telemetry, diagnostics, logs, or persisted Desktop state.
- Pi configuration files are the only source of truth: Desktop reads and writes
  `~/.pi/agent/models.json`, `auth.json`, and `settings.json`, plus trusted
  `<workspace>/.pi/settings.json`. It never creates a Desktop-owned Provider or
  model configuration copy.
- Global Provider, credential, default-model, and visual-assistance settings use
  App authority and remain available before any Workspace is registered. Project
  default and visual-assistance overrides remain Workspace- and trust-bound; an
  unavailable, identity-changed, or untrusted Workspace cannot block the global
  settings view and cannot be used to read or mutate project configuration.
- Visual assistance is an optional Pi setting stored at
  `pi67Desktop.visionAssistant`. The global value selects one configured
  image-capable Pi Provider/model pair. A trusted project may inherit it, disable
  it, or select a different configured image-capable pair. The Settings presets
  for `Qwen3.7 Flash` and `Doubao Seed 2.0 Mini` only prefill editable custom Pi
  Provider definitions; they do not create a second Provider registry, embed a
  credential, or assert that a billable live request has succeeded.
- A selected chat model that accepts images receives static image attachments
  directly through Pi. For a text-only chat model, all images in the Turn and a
  bounded copy of the user's task text are sent once to the effective visual
  assistant through Pi's existing authenticated `ModelRuntime.completeSimple`
  path before the main Prompt begins. The resulting text description, never the
  image bytes, becomes hidden context for the selected text-only model. Desktop
  does not silently change the selected chat model or route a failed native image
  call through the helper.
- Successful helper output is persisted in Pi JSONL as a typed, non-context
  `pi67.vision-assistance.v1` evidence entry plus its hidden text-only context.
  The transcript exposes a collapsed evidence card with the Provider/model,
  attachment identities, token/cost metadata, and description. Prompt, image
  bytes, credentials, and raw Provider payloads remain absent from diagnostics.
  If helper configuration or execution fails, the main model is not invoked; the
  failed pending Turn and its Task-scoped claimed attachment set remain available
  for an explicit retry with a new submission identity.
- Desktop registers one built-in `Groland` Provider with one Pi credential and
  seven image-capable reasoning models. `claude-opus-4-6`, `claude-opus-4-7`,
  `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-sonnet-5` use Anthropic
  Messages at `https://api.sciencetoken.ai/proxy/anthropic` with protocol-native
  `x-api-key` authentication. `gpt-5.4` and `gpt-5.5` use OpenAI Responses at
  `https://api.sciencetoken.ai/proxy/openai/v1` with protocol-native Bearer
  authentication. No credential is embedded in source, model metadata, snapshots,
  or diagnostics.
- Native-search capability is declared only for a protocol-matching built-in
  model: Groland Claude uses Anthropic Web Search, Groland GPT uses Responses
  `web_search`, Pi's official Anthropic/OpenAI Providers use their corresponding
  protocols, and Pi's official DeepSeek Provider declares native search only for
  `deepseek-v4-flash`. Other models have no native search route and fail visibly
  without Provider fallback. The Settings label
  `原生搜索 · 已声明` describes routing metadata, not a completed live request.
- DeepSeek native search calls the official Responses `/responses` endpoint with
  `stream: true`, reuses the selected Provider credential, and maps the official
  `response.web_search_call.in_progress`, `.searching`, and `.completed` events
  to bounded Tool progress. The credential remains a Pi `auth.json` credential;
  search does not create a second key, Provider, or persisted preference.
- Web Search has no product switch and no persisted enable/disable preference. The
  model decides when the Pi SDK or protocol-native Provider search capability is
  needed for the task. Pi-67 only presents search execution, sources, and citations
  after the model actually invokes it. `Cmd/Ctrl+F` current-conversation body find,
  `Cmd/Ctrl+Shift+F` bounded Workspace conversation search, and `@file` Workspace
  references are separate local navigation/input capabilities and never toggle Web
  Search.
- Settings `用量分析` rebuilds a `7d`, `30d`, or `90d` report only from the current
  Workspace's Pi JSONL. It aggregates assistant-message, tool-result, compaction, and
  branch-summary usage by UTC date and Provider/model, including input, output,
  cache-read, cache-write, total token, and Pi-recorded cost when present.
  Each window covers exactly that many consecutive UTC calendar dates ending on the
  report's generated UTC date; zero-usage dates remain explicit positions in the daily
  series rather than disappearing or extending the window to older active dates. Unique
  Session counts are calculated by the bounded Host scanner. Pi-recorded cost is not
  a Provider bill or public-pricing estimate, and Pi-67 does not invent reasoning or
  subagent token attribution. Catalog gaps, unreadable/invalid/future-format Sessions,
  undated entries, scan limits, and deadline exhaustion remain visible as coverage
  facts. The current implementation is a bounded cold rebuild; no incremental or
  persisted Usage cache is claimed.
- Removing a custom Provider deletes only its `models.json` definition and does not
  silently remove a same-named `auth.json` credential. Persistent credential removal
  is an independent confirmed operation against `auth.json`.
- Desktop watches those Pi files and publishes revisioned snapshots. A clean
  view adopts external TUI, script, or manual edits automatically; an unsaved
  draft remains intact and must explicitly adopt the newer revision before it
  can overwrite anything.
- Initial global Provider configuration reads are independent of Workspace,
  Task Runtime, and Session Catalog initialization. Manual global get/reload
  refreshes the canonical Pi agent files; project get/reload refreshes only its
  available trusted Workspace. File access, offline Pi model validation, settings
  reload, and Renderer acknowledgement each have nested budgets. A stalled
  validation returns an `invalid` snapshot with bounded diagnostics; a stalled
  file read returns a structured recoverable error before the Renderer transport
  budget expires.
- Creating the Pi `ModelRuntime` for a real Task uses the same 4-second Host-side
  offline startup budget. If Pi configuration loading stalls, Workspace/Session
  initialization returns a structured recoverable `RUNTIME_NOT_READY` failure with
  stage `session-model-runtime` instead of waiting for the Renderer acknowledgement
  timeout; a later retry creates a fresh runtime attempt rather than adopting the
  timed-out result.
- An idle Task applies a valid model-catalog change immediately. A running Task
  marks the reload pending and applies it after the current Operation settles.
  Removing the selected model clears the selection and blocks the next Prompt
  until the user chooses an available model.
- Common Provider and model fields use bounded forms. Advanced JSON cannot carry
  `apiKey` or header values; credential and header mutations are write-only.
  Stored API keys remain absent from snapshots, events, projections, logs, and
  diagnostics, with only the bounded one-shot reveal response exempted.
- Release performance meets `docs/testing/performance.md`.
- Prompt drafts and attachments are cleared only after the Agent Host accepts
  the operation for the same Host epoch, Session ID, and Session generation that
  submitted it. Transport failure, Host replacement, or a concurrent Session
  switch preserves the draft and rotates the retry submission identity.
- The Composer exposes one `+` attachment action and one in-editor `/` catalog.
  The catalog presents four explicit groups: `Pi 内置`, `扩展命令`, `提示词`, and
  `技能`. The first Desktop-native set is `/new`, `/model`, `/name`, `/compact`,
  `/resume`, `/tree`, `/reload`, `/settings`, `/plan`, and `/default`; these call
  existing Renderer/Workbench Controllers rather than Runtime `command.invoke`.
  Pi-resolved Extension commands, Prompt Templates, and Skills such as
  `/skill:design-craft` retain their current Runtime or Prompt paths. Click and
  Tab insert, Arrow keys only move selection, and an exact command plus Enter
  executes it; a partial token plus Enter completes it. IME confirmation does
  neither. Unsupported known Pi TUI builtins stay visible as an inline Desktop
  compatibility error and are never sent to the model. `/name 新标题` renames the
  current conversation directly; bare `/name` opens the shared rename dialog.
  Runtime catalog loading or failure never removes the Desktop-native group.
- Every provisional draft and materialized Pi Session owns `execute | plan`
  interaction mode. A provisional choice is checkpointed with the draft; after
  Session creation, only an authority-matching Host acknowledgement changes the
  visible mode. Plan Mode admits only read-only inspection, first-party search,
  and Plan interaction, with `PLAN_MODE_READ_ONLY` enforced before YOLO or any
  one-shot approval decision. Pi must ground discoverable facts in live evidence,
  ask only for materially blocking intent, and audit that every material requirement
  maps to a concrete change and observable acceptance evidence before `plan_complete`.
  The Plan covers non-goals, concrete locations where discoverable, dependency order,
  failure/recovery, compatibility, risks, tests, and explicit assumptions without a
  mandatory heading template. `plan_complete` stores the complete Markdown Plan
  in the current Pi JSONL and publishes a persistent Timeline review card; it never
  starts work. Only the active proposal owns a compact action bar above the Composer
  with `复制` plus one contextual primary action: a non-empty Composer shows
  `继续完善` and submits the user's exact text, attachments, Workspace files, and
  review comments through the normal Composer path; an empty Composer shows
  `开始执行`. Pi-67 never inserts a generic refinement Prompt. `开始执行` sends only
  `planId` and a fresh `submissionId`. Agent Host binds that request to the accepted
  Operation and writes a durable requested marker in the same Pi JSONL, but the Plan
  remains active until that exact Runtime observes Pi `agent_start`. Only then does
  Pi-67 write the started marker and compatibility decision, consume the active Plan,
  remove the action bar, and show the Timeline entry as `implemented`. Failure,
  Runtime rebind, or Host loss before `agent_start` restores Plan Mode and the same
  proposal for a retry with a new `submissionId`; failure, cancellation, or Host loss
  after `agent_start` never restores it because the implementation Turn may already
  have changed files or external state. Historical Plans may be expanded and copied
  but never executed again. Renderer never supplies Plan Markdown in the implementation
  request or creates a separate durable Plan store.
- Prompt Stash preserves exact text plus image attachments in Task-scoped encrypted
  draft state. It accepts at most 20 items, 256 KiB of text per item, 2 MiB of total
  stashed text, 32 MiB of images per item, 128 MiB per Task, and 512 MiB globally;
  non-image attachments and drafts containing `@file` references are rejected.
  Main reads images only from authoritative attachment staging, encrypts each payload
  with `safeStorage`, stores ownership plus hash metadata, and exposes only opaque
  item/blob references across IPC. Stashing clears the Composer only after encrypted
  image storage and both draft persistence phases are acknowledged; any failure
  preserves or rolls back to a non-lossy state. Restore is allowed only into an empty
  Composer, creates new staging identities after decrypt/hash validation, is durably
  removed from the stash, closes the Popover, and returns focus to input.
- Composer context pressure becomes warning state at 75% and critical state at 92%.
  Manual compression uses Pi's native `session.compact`; automatic and manual
  compaction are labeled separately, never show duplicate actions, and remain legible
  with Reduced Motion.
- A draft supports at most 20 local attachments, 100 MiB per file, and 250 MiB
  total. Pathless clipboard files have a stricter 16 MiB boundary, and supported
  Pi-native PNG/JPEG/GIF/WebP images have an independent 32 MiB aggregate memory
  boundary. Renderer reapplies that budget to the complete draft using Main's
  authoritative staged `kind`, and Host applies it again before Operation acceptance.
  Main opens a selected regular file without following its final link,
  binds the handle to the selected size/mtime and physical identity, verifies the
  same handle again after copying, and stages the resulting hash in a private
  disposable root. Only opaque references cross Preload and Protocol; the Agent
  Host copies each item from its revalidated non-following handle into a private
  temporary claim, atomically publishes the complete set, and only then removes the
  original draft copy. A pre-commit failure or Host crash therefore leaves the draft
  references retryable. Images use Pi native image content, while
  ordinary files are inspected through the hidden bounded `read_attachment`
  Tool. Renderer projections contain names, types, sizes, and opaque identities,
  never filesystem paths, source bodies, or raw attachment bytes. After obtaining
  the single-instance lock, Main removes at most 16 abandoned UUID run roots older
  than 24 hours by same-parent quarantine rename; it never touches the current run,
  links/junctions, non-directories, or non-UUID entries, and cleanup failure does not
  block startup.
- A claimed attachment set is durably bound to the hashed Task and submission
  directories for the current app run. A replacement Agent Host may recover only
  the requested set from that same Task through a 128-set bounded scan, after
  revalidating the claimed manifest, exact item inventory, regular-file identity,
  size, metadata, and SHA-256. The same 128-set limit gates new claim admission;
  idempotent replay does not consume another slot. Another Task cannot adopt the set.
  Explicit Task disposal removes its claimed directory only after Runtime disposal
  succeeds; a cleanup failure remains retryable. Host replacement preserves it, and
  Main deletes the whole run-private root only after the Host has stopped. Operation
  acknowledgement alone does not delete claimed bytes because the active Task may
  still use `read_attachment` in a later turn.
- Attachment extraction is offline and bounded. Text, Office/PDF, archives,
  audio/video metadata, binary strings/bytes, and image OCR run in cancellable
  worker threads with a two-worker ceiling, single-OCR concurrency, queue and
  timeout limits, archive traversal/path-depth/name-length/ratio/entry/expanded-size
  checks across the complete archive (including entries after a requested ZIP item),
  and 32 KiB truncation-aware Tool results. Agent Host transfers bytes read and hashed
  from the verified handle; extraction workers never reopen the claimed payload by path.
  Failure stays observable and never falls back to a network OCR
  service.
- The collapsed Composer model control shows only the readable model name. Its
  open list keeps Provider ownership and the complete `provider/model-id`
  visible for disambiguation without consuming permanent Composer width.
- Long-running work has an explicit accepted/running/waiting/terminal lifecycle,
  and Host replacement cannot make a stale response or extension request current.
- Visible Turn activity is derived from real Pi SDK events and owned by the Agent
  Host. The renderer does not infer thinking, Tool use, or interactive-wait state
  from local UI actions, and unknown Provider phases remain generic running state.
- Steer and follow-up delivery is strictly FIFO and bounded in the Agent Host.
  The Host admits at most 32 queued delivery commands by default and fails closed
  with `RESOURCE_LIMIT_EXCEEDED` instead of growing an unbounded Promise chain.
  Clearing the queue cancels Host-admitted work that has not reached Pi, waits for
  the current delivery to finish, clears Pi's accepted queue, and orders later
  delivery behind that barrier without returning Prompt content.
- A hung Pi abort cannot leave Desktop permanently busy or release a second Turn
  into the same Runtime. A bounded watchdog marks the Operation lost and replaces
  the poisoned Agent Host through the supervised restart policy.
- A same-Host MessagePort interruption renews the Port and resynchronizes the
  active projection without reinitializing Pi; only a new Host epoch restores
  the runtime from workspace and Session authority.
- Application quit is fenced by Main: the Agent Host stops accepting commands,
  invalidates queued work, cancels interactive requests, attempts to abort the
  active Operation, disposes the Pi Runtime, and exits before Electron continues
  quitting. A bounded deadline force-kills an unresponsive Host rather than
  leaving an Agent or Tool process behind indefinitely.
- Synchronous runtime, workspace, Session, model, thinking, and resource mutations
  use stable idempotency keys and a bounded same-key transport retry. Lost responses
  cannot duplicate Session creation or replay a control mutation into a newer Session
  generation.
- `新建会话`, `Cmd/Ctrl+N`, `Cmd/Ctrl+T`, and `/new` first create only a
  Renderer-owned New Session Intent. The intent is an offline-capable Composer surface,
  not a Pi Session: it does not connect a Runtime, call `session.create`, or create Pi
  JSONL until the first Prompt is submitted. That first submit materializes the same
  Workbench Task under one stable creation authority and waits for its exact physical
  Session identity before sending `prompt.submit`. Creation failure keeps the text and
  attachments on the intent; if creation succeeds but Prompt submission fails, retry uses
  the already materialized Session and never creates a second JSONL.
- If `session.create` still ends with an unknown acknowledgement outcome, Desktop
  never submits a second create automatically. It keeps one provisional conversation
  in persisted Workbench state and reconciles it by the stable `creationId` written as
  an exact marker in the created Pi JSONL. `session.creation.resolve` must return that
  marker's exact Session ID, opaque physical JSONL identity, and canonical path. That exact JSONL evidence materializes
  the placeholder as a resumable Session immediately; SQLite Catalog availability,
  rebuilding, fallback, or projection failure affects metadata only. Missing,
  ambiguous, or unavailable exact evidence stays provisional; Desktop never guesses
  from the newest empty Session, a pre-create baseline, or a creation-time window.
  `重新检查` repeats only exact marker resolution. A matching existing Task is reused;
  its empty draft accepts the provisional draft, while two non-empty drafts remain
  separate with an explicit conflict. Equal Session IDs on distinct physical JSONL files remain
  distinct; one physical identity bound to contradictory Session IDs, or one path rebound to a
  different physical identity, fails closed. `放弃此占位`
  removes only the empty Renderer placeholder and never deletes or rewrites Pi JSONL.
  A draft or attachment blocks dismissal so unsent user content cannot be discarded.
- Session creation intent is durably journaled before Pi receives a creation side
  effect. `reserved` must complete a bounded exact-marker scan before advancing to
  `materializing`; only a proven missing result may call Pi `newSession()`. An exact
  marker plus the physical JSONL identity commits `materialized`, and a constructed
  authoritative bootstrap advances `published`. After restart, `materializing`
  without an exact marker becomes `ambiguous` and cannot be replayed; a unique exact
  marker rebuilds a missing or interrupted journal instead. The journal stores only
  creation/workspace identity, lifecycle timestamps, Session identity, path, and
  physical file identity. It never stores Prompt, Assistant, Thinking, Tool arguments,
  source bodies, attachments, or credentials. Protocol v4 has no Renderer journal ACK;
  `acknowledged` remains a reserved later transition and is not claimed by this flow.
- Cross-process writer lease metadata is private, bounded diagnostic state rather
  than Session truth. It contains the app/Host instance, Host epoch, PID, token,
  timestamps, and hashes of Task and Session file identity. Raw Workspace/Session
  paths and user content are forbidden. Lock heartbeat, not PID liveness, decides
  stale recovery; a live Host cannot be displaced merely because a PID lookup fails.
- A known Workbench SessionRef opens directly through Workspace and Pi Runtime
  authority even while Catalog is unavailable or rebuilding. Catalog absence never
  proves that the JSONL is missing, and a failed background Catalog upsert cannot turn
  a successfully materialized Session into `REQUEST_OUTCOME_UNKNOWN`.
- Opening a Workspace without a known SessionRef registers the Workspace and queries a
  bounded first Catalog page before creating any Task. A real Catalog Session opens by
  exact path and physical identity. Only an authoritative `ready`, complete, empty
  Catalog may call `workspace.open` once to materialize the first Session. A rebuilding,
  unavailable, errored, or incomplete empty Catalog remains recoverable after a five-second
  decision budget and never creates a provisional ghost Task.
- Starting a New Session Intent in another Workspace first selects and registers only that
  Workspace. The later first-Prompt materialization issues one `session.create` under the
  intent Task authority. It never reuses the default Workspace-open path and therefore cannot
  create a hidden Session before the requested one.
- Workbench persistence v4 stores formal Session identity as Workspace ID, opaque physical
  file identity, and the current path locator. It does not require a Catalog row before
  persisting a live Runtime recovery record. Legacy v3 formal path-keyed recovery is discarded
  rather than promoted into physical identity; creation-authorized provisional recovery remains.
- Session import, compaction, and Extension command invocation use caller-stable
  submission IDs and content fingerprints. Before Pi receives any side effect, Agent Host
  durably records the accepted Operation ID and physical Session authority. A replacement
  Host reconciles an unconfirmed accepted/running receipt to `lost` under its current epoch
  and returns that same Operation ID without invoking Pi. Prompt image submissions remain
  user-retry-only because their transferred buffers are consumed by the first transport attempt.
  Once an Operation settles, same-Host or replacement-Host replay returns its typed completed,
  failed, cancelled, or lost receipt instead of downgrading the UI to accepted or busy.
  Projection recovery may restore a durable receipt only for the same Task generation and
  matching physical Session authority; unrelated or stale-Session receipts remain inactive.
  Renderer notifications project those terminal receipts into one memory-only history
  entry keyed by `hostEpoch + operationId`, so realtime events, ACK replay, and resync
  cannot produce duplicate task outcomes. The history is capped at 50 entries, the
  recent terminal dedupe ledger at 512 keys, visible Toasts at four, and closing a
  Toast never deletes its history entry.
  Cancellation is advertised only when the Host owns a real abort path; an
  uninterruptible Session import never reports a false stopped state.
- Active Operations publish bounded typed heartbeats separately from business
  activity. Business inactivity may produce a non-terminal quiet warning while a
  responsive Host continues running; overdue control-plane heartbeats progress from
  warning to one same-Host projection resync and never manufacture a failed result.
  Approval and Extension input waits remain user-owned and do not trip the watchdog.
- Conversation and session-tree projections remain bounded and rebuildable;
  opening a long JSONL session does not require mounting or transferring its
  complete history.
- Every Session snapshot carries a bounded compatibility view: `compatible`,
  `partial`, or `future-format`, plus the supported/current format versions and
  counts of unknown or unrenderable entries. Known messages continue to render;
  unknown raw entry bodies never cross the protocol or enter diagnostics. A visible
  warning offers exact projection resynchronization and Doctor navigation. Pi JSONL
  remains authoritative. The compatibility view is currently informational and does
  not independently gate every Session mutation; existing physical-identity, active-
  branch, external-change, Task-generation, and Host-epoch guards continue to own
  mutation safety. A future format is never treated as proof of compatibility merely
  because its known messages can be rendered.
- Session image data does not travel in Snapshot or Message Page JSON. Visible
  images load through bounded generation-bound transferable asset chunks, while
  unsupported, stale, or unavailable images fail explicitly without exposing
  old Host state.
- Session navigation uses a disposable, rebuildable metadata-only Catalog with
  bounded keyset pages. Pi JSONL remains authoritative; the Catalog never stores
  Prompt, Assistant, Thinking, Tool, source, Patch, image, or transcript content,
  and never authorizes Session creation, writer ownership, or opening a known JSONL.
- Each Catalog row carries an opaque physical JSONL identity. SQLite schema v3 uses
  that identity as the entity key and keeps path only as a unique open/display
  locator. A locator change for the same physical file updates one row; equal Pi
  Session IDs on distinct physical files remain distinct. An incremental identity
  contradiction fails closed and requires full JSONL reconciliation.
- For unnamed rows, the Agent Host reads only a bounded reverse JSONL stream and
  walks from the current leaf through `parentId` to find the latest topical user
  message on that branch. It does not open a cold Task Runtime, parse every
  Session through `SessionManager.open()`, scan outside the requested page, or
  persist the derived text. Consequently Catalog search is authoritative for
  explicit names, Session path, and Session ID; it does not perform an unbounded
  all-history Prompt scan to find cold automatic titles.
- The active managed Session uses file and parent-directory watchers only as dirty
  signals. An authoritative bounded JSONL tail verifies file identity, byte offsets,
  strict UTF-8, physical-line limits, and complete JSON records. Appends already
  present in the current Pi `SessionManager` are accepted as Desktop writes; an
  external append, truncate, replace, deletion, indirection, or malformed line
  latches the Session read-only, interrupts an active turn, and requires reopen or
  repair before another mutation. The renderer receives only a typed reason and
  recoverability flag, never the Session path.
- The Inspector has five primary views: `文件`, `修改`, `消息`, `代理`, and `上下文`. Files is a
  lazy, bounded navigator for the registered trusted Workspace and remains
  available without initializing a Task Runtime. Directory clicks expand in
  place; ordinary file clicks open or focus the file in Pi-67. A compact
  flat plus-and-chevron menu owns create-file and create-directory, with an accessible
  label and tooltip but no redundant visible `新建` text, persistent outline, or pill;
  refresh remains a separate toolbar action in the same visual language. The filter
  row and action group remain visually unboxed rather than becoming one large capsule;
  only an individual icon action receives transient interaction feedback. The row
  menu and native right-click menu order `在 Pi-67 中打开`, system-default open,
  relative-path copy, absolute-path copy, Finder/Explorer reveal, rename, and
  confirmed trash operations. Search results show the file name and relative
  path so duplicate names remain distinguishable. Dependency and generated
  directories are hidden from both the tree and search by default; changing
  `显示依赖/生成目录` refreshes both while retaining expansion, selection, and
  scroll state. A failed child-directory read owns a local retry action.
- `Cmd/Ctrl+Alt+F` and the Command Palette open Workspace file-body search. It is
  separate from filename/path search, conversation search, and Provider Web Search.
  Agent Host accepts only a trusted registered Workspace, never follows symlinks,
  always excludes `.git`, reads only strict UTF-8 regular files, and excludes common
  dependency/generated/cache directories unless explicitly included. One request is
  bounded to 256 query characters, 200 matches, 2,000 files, 1 MiB per file,
  64 MiB total, 4,096 characters per line, 320-character snippets, and three seconds.
  Results carry opaque file identity, exact revision, original-text line/UTF-16 column,
  and a bounded snippet. Case-folded matching maps positions back to the original
  text. Skips, deadline/limit exhaustion, or unsafe reads are reported as incomplete.
  Opening a result revalidates the exact revision and line target; a dirty or stale
  editor draft fails closed instead of navigating against different bytes.
- Create-file, create-directory, rename, and draft-save-as use one stable naming
  dialog with a visible name label, destination summary, inline validation, and
  recoverable request errors. Create-file additionally offers `自动识别`,
  Markdown, TypeScript, JavaScript, JSON, YAML, and plain-text choices. The choice
  only synchronizes or supplements the filename extension; `name + kind` and the
  resulting extension remain authoritative across the protocol and editor.
  Empty names, separators, control characters, trailing dot/space, `.git`,
  Windows-reserved basenames, and names over 255 characters fail before submit
  and are still revalidated by the Host. Enter never submits during IME
  composition, and a failed mutation preserves the typed name and focus.
- `在 Pi-67 中打开` creates one Workspace-scoped file tab or focuses the existing
  tab for the same relative path. The fixed `对话` tab remains available, file
  tabs survive Conversation and Settings navigation, and selecting a Conversation
  returns to `对话` without closing those tabs. File navigation never starts,
  stops, or replaces a Pi Task; a background Task keeps running while a file tab
  is active.
- The first editor release accepts only regular, non-symlink UTF-8 text files up
  to 2 MiB and provides line numbers, syntax highlighting, search, undo/redo, and
  `Cmd/Ctrl+S`. Binary, invalid UTF-8, oversized, symlink, missing, and special
  files fail explicitly. Saves require the revision that was opened and refuse
  to overwrite an externally changed file; the recovery actions are
  `放弃草稿并重新读取` and `将草稿另存为`. Any reload that would replace a dirty
  draft requires an explicit confirmation and preserves the draft if the read fails.
- Renderer requests carry Host-issued opaque references rather than absolute
  paths. Host and Main revalidate Workspace registration, filesystem identity,
  containment, kind, trust, and `.git` exclusion at each boundary. Clean tabs and
  encrypted dirty drafts are restored across restart through Electron
  `safeStorage`; when encryption is unavailable, dirty source is not persisted in
  plaintext and exit remains guarded. Limits are 32 tabs per Workspace, 128 per
  app, and 20 MiB of dirty draft text. File bodies never enter Workbench state,
  Pi JSONL, notifications, diagnostics, logs, or telemetry.
- Changes has two explicitly separate read-only projections. `会话修改` presents
  the current active branch's bounded Pi Session `edit` and `write` facts. It
  summarizes retained files and total records, lists the newest
  records first, preserves cached content while a refresh is pending or fails,
  and owns explicit loading, empty, stale, error, and truncation states. Every
  projection remains fenced by Host epoch, physical Session identity, Session
  generation, and projection revision, so a delayed response from another Task
  cannot replace the visible list.
- Changes groups completed records by `第 N 轮` and keeps not-yet-settled live facts
  under `当前操作`. A selected record becomes `已查看` only for its exact content
  fingerprint; a later path/status/Patch/metrics revision for that `toolCallId`
  returns to `未查看` without silently changing the selected detail.
- An `edit` record may expose the Host-bounded Patch, additions/deletions, first
  changed line, Tool status, and truncated-path/Patch notices. The Renderer caps
  the rendered Patch at 600 rows independently of the 64 KiB Host Patch budget.
  A `write` record shows only bounded bytes/lines metadata because Pi does not
  provide a before-version. It never reads Workspace files or Git from the Renderer
  to manufacture missing history.
- `工作区变更` is an independent Electron Main-owned, bounded Git observation for
  the selected registered Workspace. Main resolves the authoritative cwd from
  Workbench state, runs packaged private Git status/diff with time/output budgets,
  and gives Renderer only revision-scoped opaque `changeId` values plus display
  paths. Detail requests carry only `workspaceId + revision + changeId`; Main
  revalidates Workspace identity and the status fingerprint before and after each
  bounded Patch read. This surface never stages, discards, commits, pushes, opens a
  PR, or claims to replace a full Git client.
- Complete, line-mappable Session and staged/unstaged Git patches support an explicit
  review lifecycle: `Viewed` is exact-fingerprint inspection, `Reviewed` is a separate
  user confirmation, `Pending` means one or more line comments are waiting in the
  Composer draft, and `Stale` means the bound Diff authority changed. Each comment is
  anchored to old/new line, section, content fingerprint, opaque file reference, and
  exact file revision. Truncated or non-mappable patches cannot accept precise comments.
  Comments persist only inside the encrypted Task draft; Patch bodies do not. On send,
  comments become bounded Prompt text plus existing opaque Workspace file references,
  never a second Agent side effect. Only acceptance of the exact submission snapshot
  clears its comment IDs; rejection or terminal failure retains them, and comments
  added while that submission is in flight are not removed by the older acceptance.
- Messages is a paged index of only the user's messages on the current Pi Session
  active branch. It excludes Assistant, System, Tool, Thinking, and Session
  control entries, and can locate an unloaded message through one bounded
  historical conversation window without transferring the complete JSONL.
  Historical mode is visibly read-only and offers `回到最新消息`.
- Agents projects the native child roster owned by the current Task and exact
  Session generation. Each child is an independent Pi JSONL Session, not a Browser
  Profile and not a top-level Task slot. The bounded roster shows lineage, lifecycle,
  foreground/background mode, model, reasoning, duration, usage, result, and error,
  and exposes steer, stop, and resume through the parent Task authority. A Host restart
  changes any previously live child to `interrupted`; it never claims detached work is
  still running. Worktree isolation remains explicit and fail-closed until Electron
  Main authority creates and retains a reviewable Worktree.
- Active-branch `edit` and `write` facts enrich their matching Tool cards by
  `toolCallId` and feed the Changes view from the same authority-safe projection.
  These facts never claim to be a complete Git or Workspace diff. Session
  branching and rollback lives in
  the dedicated `会话分支与回退` dialog opened by `/tree` or the command palette
  rather than appearing as an Inspector tab.
- Safety approval is a dedicated, fail-closed single-Tool-Call flow bound to
  Host epoch, session generation, request, and Pi `toolCallId`. Ordinary parent
  execution also binds the active Operation; a background native child instead
  binds its explicit child lineage and does not borrow a later parent Operation;
  ordinary Extension confirmation cannot impersonate it. Skill selection and
  model routing do not create a separate authorization step: each actual Tool
  Call is classified at execution time against the current trusted Workspace,
  active Session resources, verified Tool identity, and requested side effect.
  An authoritative Operation terminal invalidates any still-rendered interactive
  request for that exact Operation without granting or retrying the Tool.
- An automatically admitted Tool exposes one bounded Host/Runtime-authored reason
  in its execution row: `AUTO · 已配置来源`, `AUTO · 只读`, or
  `AUTO · Workspace 内写入`. Renderer code never infers this reason and Pi JSONL
  is not rewritten to persist it; raw Tool args, results, prompts, source paths,
  URLs, and credentials never enter this projection.
- The approval dialog names the verified Tool source and offers `拒绝`,
  `仅允许本次`, and `本任务开启 YOLO`. The third action atomically allows the
  current and other pending Safety Approval requests in the same Runtime, but it
  never resolves ordinary Extension `ctx.ui` requests. Composer-initiated YOLO
  selection requires a second confirmation in the same upward menu.
- A blocking Safety Approval or Extension input distinguishes resolving only the
  current interaction from stopping the entire Task. `拒绝`/`取消当前输入` answers
  that one request; `停止整个任务` is available only when exactly one current Task
  matches Host epoch, Session ID/generation, Operation ID, and waiting lifecycle.
  Task stop sends `task.close { mode: "stop" }`, not `operation.abort`, and removes
  the Task only after the Runtime stop succeeds. Missing, stale, or ambiguous
  authority fails closed and leaves the dialog and draft recoverable.
- Tool mode never weakens Workspace trust, Extension UI separation, operating
  system permissions, Electron sandbox and preload boundaries, credential
  isolation, update/signing rules, or any capability outside the current Pi
  Task Runtime.
- Production `app://pi67` assets accept only the exact scheme/host without
  credentials, port, query, or fragment. Malformed or repeated percent encoding,
  encoded separators, control bytes, dot segments, drive/UNC forms, ADS colons, and
  any path outside the resolved Renderer root fail closed.

## Accessibility and localization

- Chinese is the default language; English has behavioral parity.
- Core flows support keyboard-only operation, Narrator, and VoiceOver.
- Focus is restored after dialogs and drawers close.
- Appearance defaults to the operating system and offers explicit System,
  Light, and Dark choices without involving the Agent Host.
- 200% zoom, Reduced Motion, light mode, and dark mode retain all primary actions.
- Status is never encoded by color alone.

## Privacy

- Local-first and no analytics or PostHog in v1.
- Renderer-local storage may persist only the non-sensitive appearance preference. Composer
  text and `streamBehavior` use a separate bounded Desktop UI state document owned by Electron
  Main and encrypted as one payload with `safeStorage`; Session paths inside its exact
  conversation keys are encrypted with the text. If secure storage is unavailable, Desktop
  keeps the current in-memory draft but writes no plaintext fallback. The document never stores
  attachments, staged attachment handles, transcript, Tool payloads, source bodies, credentials,
  or a second authoritative Session history.
- Electron Main may persist a bounded, schema-validated Workbench V5 layout with
  Workspace identity and ordering, expanded Workspace IDs, the selected
  conversation or Settings surface, Settings scope, at most eight runtime recovery
  identities, and clean-exit state. Ordinary idle Session rows are rebuilt from
  Catalog instead of being persisted as open UI objects. Draft text, attachments,
  transcript, runtime detail, private fallback titles, and credential material
  never enter that layout.
- Workspace restoration distinguishes durable directory evidence from a
  mount-scoped device number. On macOS, exact native canonical path, inode, and
  nanosecond birth time permit a device-only APFS remount rebind and refresh the
  persisted device value without another picker prompt. This also repairs the
  bounded legacy false-positive state produced by the former strict comparison.
  Any path, inode, or birth-time change, and every path-only registration, remains
  fail-closed and requires the existing explicit native-picker confirmation.
- Revision-aware Pi configuration, Context Markdown, and Workspace-file saves use
  one same-directory atomic-replace implementation: the new file is flushed before
  a final revision fence and rename. On Windows only `EACCES`, `EPERM`, and `EBUSY`
  replacement failures receive bounded backoff; semantic conflicts such as
  `EEXIST`, a changed revision, invalid data, or a path-boundary failure are never
  retried. Provider and Context validation failures retain their existing guarded
  rollback instead of reporting a partial success.
- Operation receipts are bounded private durable recovery metadata under application storage.
  They contain caller-stable IDs, SHA-256 fingerprints, lifecycle, timing, Host/Task/physical
  Session authority, and redacted structured terminal errors only; Prompt text, import paths,
  commands, compaction instructions, source, attachments, credentials, and raw tool payloads
  are never stored in the receipt ledger. POSIX storage uses private directory/file modes and
  atomic locked replacement; corruption or unsafe filesystem metadata fails closed before Pi.
- Renderer notification history is also memory-only and is cleared on application exit.
  It stores only bounded presentation text and terminal identity/timing metadata; it
  does not persist Prompt, source, command text, paths, credential values, Protocol
  error details, or raw payload objects in localStorage, SQLite, JSONL, or diagnostics.
- Native operating-system notifications are emitted only for a background or hidden Session
  completion, failure, or interactive-attention state. Renderer sends Main only a bounded
  notification ID plus opaque Workspace/physical Session identity and a fixed kind; Main owns
  all displayed title/body copy, so Prompt, source, Tool output, error detail, Session title,
  and absolute paths cannot enter the native notification. Clicking one focuses or recreates
  the main window and activates the exact matching Workbench Session; stale or missing identity
  fails visibly instead of opening the newest Session.
- Electron Main owns the disposable Session Catalog location. Its SQLite rows
  contain only bounded opaque physical identity/Session ID/path/cwd/explicit-name/count/time/parent
  metadata plus pin/archive timestamps projected from the organization store;
  unnamed Sessions never store their automatic title there.
  POSIX catalog storage must remain current-user-owned with directory `0700` and
  database `0600` permissions or fail closed to the disposable SDK projection.
- Conversation pin/archive state is a separate bounded private document under
  the Agent Host storage root. It stores only a version, a SHA-256 key derived
  from Catalog source plus opaque physical Session identity, and pin/archive timestamps;
  it stores no raw path, title, Prompt, transcript, source, or Tool content. The
  file is atomically replaced, limited to 10,000 records and 4 MiB, and uses
  `0700` directory / `0600` file permissions on POSIX. Corrupt state is
  quarantined and the rebuildable Catalog remains usable without inventing
  organization state.
- Catalog schema v3 keeps the existing DELETE journal and `BEGIN IMMEDIATE`
  transaction contract. WAL remains deferred until main DB, `-wal`, and `-shm`
  ownership, corruption isolation, checkpoint, Windows locking, and recovery are
  verified as one atomic storage bundle.
- Catalog search may normalize user text, but filesystem source/workspace identity
  never uses Unicode compatibility normalization. Link-based storage indirection
  outside Electron `userData` fails closed instead of following the target.
- Update checks disclose their network purpose and send no workspace, provider,
  model, session, or credential data.
- Internal development candidates are not an application update channel. Git
  does not track their EXE, DMG, ZIP, identities, receipts, screenshots, or
  logs; the three versioned product files are distributed through the
  repository-external Feishu folder for target-OS manual testing. This internal
  loop stops after mirror verification by default and does not imply a Tag,
  GitHub Release, or promotion.
- Packaged Desktop builds automatically check the bounded public GitHub Release
  metadata after startup and at most once per 24 hours while running. Development
  builds stay offline. Current-version results and automatic failures are
  non-blocking; an available version is projected into the Help entry and menu.
  Manual retry remains available and explicit.
- Extension Package completion names the affected Package and, when available,
  its previous and installed versions. Resource reload events and routine
  informational Extension messages remain in Notification history rather than
  stacking duplicate floating toasts around the one final update result.
- Skill update checks are user-initiated, bounded, and use only the owning updater's
  version and official-Skill synchronization contract. Desktop does not infer an
  upstream from a directory name, pull arbitrary Skill repositories, or run an
  updater for loose or project-owned Skills. An upstream repository alone does not
  enable runtime updates. AI Berkshire is the first Pi-67 registry-managed Overlay:
  it accepts only a compatible version bound to an exact Pi-67 commit and verified
  hashed bundle, never downgrades the effective version, and rolls back atomically.
  Commerce remains Desktop-release managed until it receives the same explicit
  runtime channel contract.
  Build-time AI Berkshire refreshes are a separate immutable release input: they pin
  one upstream commit and reproduce the locked Pi-67 Pack hashes without following a
  branch during runtime.
- Unsigned Preview checks accept only complete prerelease artifact sets and open
  a canonical GitHub Release page; they never download or install in-app.
- Diagnostic export is local, bounded, and redacted by default.

## Non-goals for v1

- Pi RPC or system-Pi runtime mode.
- Non-Pi agents or providers.
- Concurrent writers for one session.
- Arbitrary rendering of TUI `ctx.ui.custom()` components.
- Embedded code editor, general terminal, or browser panel.
- Windows ARM64/x86, macOS Intel/Universal, or Linux artifacts.
