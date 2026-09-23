# Processes and protocol

## Process topology

```text
Electron Main
  |- BrowserWindow
  |    `- sandboxed renderer (React, app://pi67)
  |          `- AgentPortClient
  `- utilityProcess: Agent Host
         `- PiSdkRuntime
              `- @earendil-works/pi-coding-agent
```

Main 创建 `MessageChannelMain`，把一端交给 Agent Host，另一端经 Preload 转给 renderer。
Agent 消息不经过 IPC invoke、HTTP 或 WebSocket。Preload 的 invoke API 只用于文件夹选择、
诊断保存、通知、外部链接和更新等系统能力。

Renderer loads the protocol Port client and its validation schemas only after an
exact-source/origin Preload handoff. Loading is generation-bound: a replaced or
disposed pending Port closes without attaching, and a load failure emits teardown
so connection waiters fail observably. This does not defer or omit validation of
any message. The protocol package preserves module boundaries so lightweight IDs
and context constants do not initialize transport schemas on the Welcome screen.

## First-response diagnostic timing

`diagnostics.collect` may include `responseTiming` with fixed scope
`runtime-to-stream-emission`. Each Pi runtime keeps at most eight in-memory
receipts for ordinary submit calls. Milestones are monotonic elapsed milliseconds
from runtime submit entry: Session consistency check, pending configuration
readiness, SDK prompt invocation, SDK agent start, first nonempty thinking/text
increment and first corresponding Host stream-batch emission. Preparation before
SDK invocation includes attachment/vision work; receipt elapsed time also includes
post-prompt persistence. No prompt/body/path/credential/error text is retained.

Receipts use fixed statuses: running, resolved, rejected, cancelled, queued or
interrupted. Resolved means the submit call returned, not that a Provider answered
successfully. Cancellation only reflects the observed submission AbortSignal.
Missing milestones remain absent; never fill them with zero or invent network
TTFT. A streaming Session's queued submit is excluded from event attribution;
steer/follow-up, commands and subagents do not create these receipts. Subscriptions
are scoped to the exact Session and removed when the submission settles.

SDK invocation is not HTTP dispatch; SDK deltas are not first network bytes, and
Host emission is not Renderer receipt or visible paint. These external/display
stages remain unmeasured. Use supported Session subscriptions rather than
intercepting transport or adopting the SDK's internal RPC preflight hook. Existing
bounded diagnostic export carries these receipts on user request; no autonomous
upload, Session entry, additional logging or Provider request is introduced.

## Responsibility boundaries

Shared-knowledge receipt persistence belongs to Electron Main, not Agent Host or
Renderer. The current `SharedKnowledgeReceiptStore` is a Main broker storage
primitive: it publishes flushed page records before its atomic receipt pointer,
serializes same-directory stores within Main, and keeps receipt progress separate from indexing
and permission leases. Broker commands are connected; index recovery is not yet.
Main's `SharedKnowledgeReceiptBinding` owns its store and derives its
directory hash from a versioned tuple of localProfileId, canonical service endpoint,
signed-in userId, teamId, scopeKind and scopeId. Credential `accountId` currently
means activeTeamId and MUST NOT replace userId. Endpoint normalization preserves
service base paths and non-default ports; credentials, query and fragment are
rejected. Only HTTPS or HTTP loopback is accepted. Binding inputs must come from
trusted Main state; the class does not verify membership. `receive` rejects scope
mismatch before storage. Main must retire old bindings on identity changes:
retirement rejects future operations and completion of in-flight operations, but
already-started writes may finish in the old namespace. No data is deleted or
migrated. `EnterpriseCredentialSupervisor` now retires registered bindings before
credential bootstrap/store/clear, including failed operations. Its generation guard
prevents stale asynchronous bootstrap/store completions from reopening creation.
Host start, exact-current-Host exit and stop also invalidate creation. Main-only
`createReceiptBinding` requires a successfully loaded/stored identity, derives
userId/endpoint from its immutable non-secret snapshot, creates and registers the
binding, and retains at most 128 handles. Arbitrary preconstructed bindings can no
longer be registered. The returned release retires its handle. Credential store
requests are snapshotted before asynchronous persistence, so later caller mutation
cannot change the bound user/service. No token is retained by the receipt factory.
This identity is not authorization: root/profile/scope must still come from trusted
Main state, and membership/permission needs its own check. Automatic sync scheduling
remains unconnected. Conservatively, even same-user
credential refresh retires old handles.
Store instances now share a process-local queue keyed by the resolved directory
path, so replacement bindings wait for old-generation writes and recheck the
committed cursor. At most 16 read/write operations are admitted across receipt
stores; overflow fails explicitly, and settled idle queue entries are removed.
This is not a cross-process lock and does not resolve symlink or case aliases:
Main must use one canonical root spelling and remain the sole writer process.
Main's `receiveSharedKnowledgePage` snapshots
bytes/expectations, validates before append and returns progress only after storage
acknowledgement; empty heartbeats are not persisted. The
receiver nevertheless checks heartbeat cursor/epoch against the saved receipt:
ahead-of-disk, rewind or epoch replacement fails as an invalid page. A matching
heartbeat returns the verified existing pointer without appending a record; it
cannot manufacture durable progress from caller-supplied response metadata. The
runtime-neutral
`packages/protocol/src/knowledge-sync-page.ts` owns the common page decoder; Host
and Main supply their own SHA-256 implementation. Host retains its existing
`INVALID_PAYLOAD` error mapping. The future broker must supply Main-owned trusted
account/service/scope expectations and the matching store; this helper does not
establish that binding or turn historical lease metadata into a current grant. The
storage primitive provides explicit bounded, cancellable `verifyHistory`: it
checks a captured pointer back to cursor zero, including hashes, canonical base64,
epoch and cursor continuity, one record at a time outside the writer queue.
Only successful completion verifies that snapshot; budget exhaustion, cancellation
or corruption fails without advancing progress. Ordinary `read`/`append` validate
the tail only, not the full history. Verification is neither replay nor a grant.
`replayHistory` first verifies the entire captured chain, retaining only a bounded
hash manifest (caller budget, maximum 10,000 pages), then rereads and verifies each
record oldest-first before awaiting the staging callback outside the writer queue.
It returns the captured pointer only after all callbacks succeed; later appends
are excluded. Cancellation is cooperative and is passed to active callbacks.
This is a storage replay API, not an authorization or live index recovery path:
callers must use unpublished staging or the separately authorized reader's withheld
exact-version result, discard partial work on any error, validate page
semantics and identity, and check current head, index freshness and authorization
before exposing results. Replay neither changes receipt progress nor writes an
index cursor. No historical page or successful replay creates a permission lease.
The private `shared-knowledge-receipt-broker` protocol defines open/append/close
requests and metadata-only success or redacted failure replies for those operations.
The separately admitted exact-body operation is specified below. Open accepts only
scope; Main must authorize it before allocating an identity-generation-bound opaque
handle. Append supplies that handle, source cursor/epoch, permission revision and
bounded UTF-8 page JSON, not a user, endpoint, path, profile or grant. Unknown fields,
team-scope mismatch, lossy surrogate encoding, oversized UTF-8 and invalid bigint
progress are rejected. The append revision is correlation data, not self-issued
authorization. Open replies identify the Main-bound user/service and receipt progress
so Host can reject mismatched pending work. These schemas are versioned protocol
material only and do not implement authorization. The Main
`SharedKnowledgeReceiptBroker` now implements bounded handle allocation/close,
generation checks, page validation/persistence and redacted replies. Its required
Main-owned authorization dependency must supply a verified exact-scope grant and
permissionRevision; no default grant exists. Open checks the grant before and after
reading progress. The authorization dependency may now resolve asynchronously;
Main bounds it to eight seconds and supplies an AbortSignal. Broker invalidation
aborts pending authorization, and timeout releases the pending slot even if the
provider ignores cancellation. Late results cannot reach filesystem reads: the
broker rechecks identity and Host generation immediately after authorization.
Provider implementations must themselves honor cancellation and bound their network
resources; racing a Promise does not forcibly terminate an uncooperative provider.
Append matches the permission revision and checks the grant before and after
persisting. An explicit authorization denial (Main HTTP 401/403, represented by
an absent grant) retires all matching user/service/team/project handles and fences
already-pending opens in that exact scope. Late authorization success cannot revive
those opens; a subsequent new request must reauthorize. Other scopes are unaffected.
Transport/timeout failures reject the new open without retiring existing valid leases.
The pending-open fence is bounded by the existing 16-operation admission limit and
removed when each open settles. Append still checks authorization before and after
persistence. Failed/stale authorization retires the handle; in-flight writes may
finish in their old namespace but cannot acknowledge success. At most 16 operations
and 128 handles are admitted; new opens prune retired/expired entries. Broker
invalidation fences pending opens and retires current handles. The binding factory
supplies a non-secret identity and generation check. Main authorization resolution
is configured below; the Host sync scheduler remains unconnected. Tests use synthetic
network responses, not live grants. Main's current-Host private dispatcher now recognizes
receipt requests through `EnterpriseCredentialSupervisor`. A Main-owned optional
receipt processor is forwarded through `getSharedKnowledgeReceipts`; when identity
is absent it returns NOT_SIGNED_IN, and when no verified processor is configured it
returns SCOPE_DENIED. Credential/Host lifecycle invalidation also invalidates that
processor. Replies crossing a credential generation are replaced with STALE_HANDLE;
the existing private-port guard suppresses replies after Host replacement. Unexpected
processor failures produce redacted PERSISTENCE_FAILED, not raw errors or silence.
The application now configures the independent Main authorization processor described
below; missing/unsafe local profile still leaves it disabled. Host scheduling and
indexing are not yet connected, so this does not enable automatic synchronization.
The unconnected Host `SharedKnowledgeReceiptClient` implements private request/
reply correlation with an immutable expected user/endpoint, exact reply-operation
checks, an 8-second default timeout (bounded configurable), cancellation and
shutdown. It admits at most 16 pending requests and tracks at most 128 abandoned
opens; if replies never arrive, further opens fail capacity closed. Late successful
opens and identity-mismatched opens trigger best-effort close of the returned Main
handle. There is no retry or fallback. Cancellation does not roll back an already
started Main write, and parent-port failure may prevent orphan cleanup; Main's
Host-generation invalidation remains the final cleanup owner. The production Host
entry now routes receipt replies through `EnterpriseCredentialBrokerClient` and
shuts it down immediately when Host shutdown begins. That credential owner creates
one receipt client after bootstrap/successful store, retires it before refresh/clear,
and aborts that client's stable lifetime signal on retirement. The sync orchestrator
combines this signal with caller cancellation for authorization, page transport and
receipt operations, so retirement also cancels a stalled network read rather than
only rejecting its later IPC append. Caller cancellation is not mutated. Cleanup
close remains independent of the combined signal, with Main generation invalidation
owning final cleanup when a retired client cannot send close. The same sync run now
captures the existing Main-driven Host power epoch and combines its cancellation
signal as well. Every suspend/resume notification aborts the prior signal; suspend
rejects new runs, and resume permits only a fresh run with new authorization. No
additional native listener or automatic scheduler is introduced. Cancellation starts
when the existing Host parent-message handler receives the notification, not at an
unverified physical OS boundary. It cannot roll back an already-started Main write.
The credential owner rejects obsolete store/clear completions using a generation fence. Failed writes
do not revive retired clients, and post-shutdown bootstrap cannot recreate one.
Credential snapshots are copied before asynchronous storage. Retired-generation
replies are not routed to a new identity; Main invalidation owns their final cleanup.
Client creation sends no requests. The explicit app command `enterprise.knowledge.sync`
now routes through the Host dispatcher and enterprise authorization owner into the
sync orchestrator. Its Protocol scope requirement is explicitly `app`, so the
Host authority gate admits it without a Task and rejects Workspace/Task envelopes.
This classification grants command entry only; current login, team/project grants
and Main receipt authorization remain mandatory. It accepts only teamId, optional projectId and optional maxPages
(1–100, default 10), never credentials, filesystem paths or grants. Each invocation
uses the active login and returns receipt epoch/cursor, page count and head cursor,
not content or index freshness. At most four runs are admitted; a 60-second run
deadline combines with identity/power cancellation (bounded close cleanup may follow).
AgentPortClient gives this command a 75-second default acknowledgement deadline,
covering the 60-second run, up to eight-second close and reply margin; other command
defaults and bounded caller overrides are unchanged. The existing per-request
AbortSignal now traverses HostRequestRouter, app dispatcher and context router to
the sync owner. Renderer cancellation/timeout or connection closure therefore
cancels that sync's transport without retiring the login or cancelling other runs.
Login begin, disconnect and shutdown abort active runs; credential refresh also retires
the bound receipt client. Failures propagate, with no fallback or automatic retry.
This is an explicit command entry, not a renderer control or automatic scheduler;
local indexing and semantic-search cutover remain unconnected.
The Host Gateway's `syncKnowledge` response contains both the validated page and owned exact wire
bytes, trimmed to the received length within the 2 MiB bound. Receipt callers must
use those bytes, not serialize the parsed page (which normalizes timestamps).
The reader snapshots expectations before awaiting the stream and returns neither
representation on validation failure or cancellation. This preserves receipt input;
it does not provide authorization, persistence acknowledgement or index freshness.
The Gateway now exposes explicit `authorizeTeam` alongside `authorizeProject`.
Both use the existing authenticated transport and lease/model-policy parser; team
expectations require an omitted projectId, matching the server's team response,
while project expectations require the exact projectId. Neither scope may stand
in for the other. Main performs its own independent authorization request.
The unconnected Host `syncSharedKnowledge` composes exact team/project authorization,
receipt open, sequential Gateway pages and Main append acknowledgements. It advances
only from matching acknowledged epoch/cursor, preserving wire bytes through UTF-8
IPC (including a BOM), and checks cancellation, owner identity/power fence and the
grant around asynchronous work. A caller-supplied 1–100 page budget bounds each run;
exhaustion fails without undoing acknowledged receipts. It has no retry, renewal,
index mutation or model invocation. Handle close runs independently of cancellation
through the bounded receipt client; cleanup failure blocks an otherwise successful
result but does not replace an earlier failure. Main generation invalidation remains
the final orphan cleanup owner. Production scheduling remains unconfigured; Main's
independent authorization processor is now configured, and a Host grant never substitutes
for Main authorization. Catch-up results prove receipt progress only, not searchable
projection freshness or a model grant.
The caller must bind the exact local profile/account/service/team/project namespace;
an arbitrary scope hash or stored page does not itself grant access. Temporary
filesystem tests are not packaged/Windows or real power-loss evidence.

- `packages/domain`：无运行时依赖的策略、状态和 renderer-facing view。
- `packages/protocol`：command/event/response envelope、schema 验证和请求相关性。
- `packages/pi-runtime`：Pi SDK 适配、session/resource/model、stream batch、extension UI、
  project trust、一次性批准、disposable metadata Session Catalog，以及由 Pi 配置与 Agent Host
  Workspace 文件共同复用的有界原子文件 replace。
  `PiSdkRuntime` 只保留 `AgentRuntime` 操作语义；`RuntimeSessionBindings` 独占 Pi SDK
  `AgentSessionRuntime`、services、session generation、extension rebind 和 transition 生命周期。
- `apps/agent-host`：protocol command router、错误脱敏和 runtime 生命周期。
- `apps/desktop`：窗口、Preload、`app://`、utility process、更新与原生对话框。
- `apps/renderer`：产品 UI；不读取文件、凭据或 Pi SDK。

Pi SDK 0.86.1 transcript adaptation: Runtime retains system/tool-control records
in Pi JSONL for SDK replay, excludes them from conversation pages/counts, and
projects only a fixed tree description. Standalone `usage` entries contribute to
Session totals and Workspace usage buckets (`source: usage-entry`); raw notes and
system bodies do not cross this projection. Desktop's Session settings view keeps
optional paid cache warming off without persisting changes to user Pi settings.


The dedicated team-worker model channel uses an inherited duplex FD, not stdout,
an HTTP listener or a Renderer command. Each frame has a four-byte big-endian byte
length and strict UTF-8 JSON, capped at 3 MiB; model bodies are canonical base64
and capped at 2 MiB. Only one request may be in flight. Host limits incomplete
frame assembly to five seconds from its first byte. The native peer has a bounded
whole-exchange deadline including lock acquisition. Host owns user/team/project
identity and selected extraction/embedding endpoint/model; native input cannot
supply identity or change this binding. Each accepted request, including retries,
enters fresh Host model authorization before provider invocation. Failure,
malformed input, owner cancellation or EOF retires the entire channel; queued or
late work cannot reconnect or fall back to private memory. Provider error bodies
are redacted and redirects are rejected. The owner must retire the worker on
identity/policy/lifecycle changes and honor transport cancellation. This channel
has isolated Node-to-Python synthetic integration coverage, but is not yet wired
to an application-owned team worker, provider transport or index publication.
It does not alter Main's network exception or the private OpenViking process.
The Host enterprise authorization controller now owns admission of at most four
team model channels. It binds user/service to the current credential and resolves
current credentials/configuration before each exact-scope authorization. Credential
replacement or clearing retires the previous lifetime before persistence begins;
only acknowledged available credentials can start a fresh lifetime. Login restart,
logout, shutdown, credential expiry and native power transitions actively cancel
channels. Workspace rebinding retires only that Workspace's channels; configuration
mutation completion retires all team channels even if final readback fails after
persisting. Caller cancellation does not revoke login or unrelated channels. A
replacement or renewed credential never revives an old worker channel. Main's
future worker owner must terminate the native process on close and explicitly
create a new one; no application worker startup/relay or indexing is implied by
this internal Host admission API. Remote policy changes still require fresh grants
and the future indexing owner's active lease/revision management.

Main's low-level `startNativeTeamModelWorker` adapter starts a dedicated macOS
14+ arm64 process group with a fixed, captured positive group ID, stripped child
environment and model FD 3. It does not initialize a private profile, provision
storage, add a listener, verify an installation or establish application readiness.
Main must supply an admitted interpreter, an application-owned bootstrap and an
isolated working directory; arguments cannot carry credentials or knowledge.
Caller abort, channel close/error, root exit and setup failure close the relay and
retire the process group. Completion requires root exit, closed inherited pipes
and a fresh absent-group check, with bounded TERM/KILL escalation. A zombie may
return EPERM before Node handles exit; await bounded root reaping before retrying
the group operation, and never interpret EPERM itself as absence. Persistent
permission/cleanup failures are observable with sanitized stage/errno metadata.
The low-level Main/Host relay uses a dedicated capability MessagePort, never the
Renderer port. Each direction allows one unacknowledged chunk, capped at 3 MiB
plus the four-byte frame header, with an exact positive sequence and a ten-second
ACK deadline. It copies byte payloads and rejects malformed, shared-buffer,
oversized, duplicate or pipelined messages. ACK means the sink has accepted bytes,
not model authorization or index publication. Main pauses native reads until ACK;
the Host stream withholds ACK while its readable buffer is backpressured. Close,
message error, timeout or owner cancellation retires both ends without reconnect.
No user/team/model authority is accepted from relay packets; the existing Host
controller must bind those from trusted current state before channel admission.

Main's supervisor now exposes a dedicated internal transfer owner. It uses the
exact ready utility-process object after credential bootstrap, and refuses new
transfers during restart, shutdown, runtime poisoning or suspend. Restart clears
readiness before waiting for process exit. Existing ports close on those lifecycle
changes, native close, owner abort or exact Host exit; they never migrate to a
replacement Host. Main creates MessageChannelMain and transfers one end using
UtilityProcess.postMessage, without a Renderer route or provider credentials.
The parent metadata contains only `team-model-port-attach` and a UUID requestId,
included in the protocol revision. Host dispatches it before ordinary attach-port.
Only an internal reservation can admit a port: at most four pending/active entries,
a five-second ordinary port deadline, exact one-port cardinality, single consumption and
closure of unreserved, malformed or late transfers. Duplicate transfer retires
the existing entry too. Enterprise reservations copy scope/model selection and
bind credential, caller and power lifetimes before transfer; configuration/rebind,
login and shutdown also retire pending entries. Actual model frames still pass
the existing current-state authorization guard. Port connection is not a grant.
Worker reservations explicitly use the internal `worker` phase: they hold a slot
for at most 65 seconds (60-second Main preflight plus five-second dispatch margin)
but cannot accept any port until the exact Main `prepared` state activates them.
Activation starts the unchanged five-second port deadline. Early transfers,
duplicate/late activation and expired transfers retire the reservation; ordinary
`port` reservations cannot be silently upgraded by the worker broker. Both phases
share the four-entry limit and the same credential/caller/power lifecycle. Deadline
checks use monotonic time as well as timers, so delayed callbacks cannot revive an
expired activation or transfer. This pending slot never authorizes model processing.
An isolated Electron probe verifies the real utility transfer and bidirectional
synthetic bytes, owner abort, Host exit and unreserved rejection. It does not run
the product Host entrypoint, native Python, real model authorization or indexing;
the authorization controller and supervisor wiring have separate source tests.

The startup parent protocol now accepts only `team-worker-start` or
`team-worker-cancel` plus the reserved UUID, and emits a bounded state enum. No
path, executable, arguments, credential, scope or knowledge body is accepted from
these messages. Main's internal TeamWorkerSupervisor must first register an exact
Host-bound, one-shot permit with a verified interpreter/bootstrap, isolated cwd
and owner cancellation. It copies the launch selection, allows at most four
pending/running permits, expires unused permits after five seconds, bounds preflight
to 60 seconds, bounds subsequent spawn/relay setup to five seconds and limits a
running worker to five minutes. Unregistered requests cannot spawn a process;
duplicate starts cancel the existing run. The application does not yet prepare
these permits automatically: initial signed bootstrap/storage preparation precedes
the exchange; final full signed-tree and snapshot revalidation runs in the explicit
bounded preflight phase, not inside the short active-port window.
Main emits `prepared` only after that preflight and before spawn/port transfer, in
order on the same parent channel. Host activates its dormant worker reservation
and five-second startup timer only on this state. `prepared` is neither a process
startup receipt nor a model grant. Out-of-order/duplicate states fail closed; a
started worker with no admitted port must still be cancelled when admission fails.
Protocol revision binds both the state enum and phase deadlines; no silent fallback
to the earlier single-phase handshake is provided.
Main attaches the native FD using the dedicated port owner and reports `started`
only after spawn/relay setup. Host startup also requires successful port admission.
`completed` means zero exit with confirmed physical cleanup, not index completion
or publication; `cancelled` is likewise sent only after confirmed cleanup. A model
port EOF alone is not a terminal worker receipt. Host bounds terminal receipt waits
and cannot report successful cleanup after timeout. Main shutdown waits for native
completion independently of Host shutdown. Unconfirmed low-level launch/cleanup
failures remain observable, block new permits for this supervisor lifetime and
reject shutdown confirmation; there is no automatic recovery or private fallback.
Restart, poisoning, power changes, owner cancellation and exact Host exit retire
both pending permits and active workers. No directories are provisioned or deleted
by this supervisor; the trusted staging owner retains that responsibility.

`createInstalledLocalMemory` now exposes Main-only `teamPreparation.prepare` without
starting IO or resolving model settings during construction. It reuses the private
runtime manifest/tree/interpreter admission rules and the existing receipt owner key;
the stable receipt namespace is unchanged. Preparation reads an existing private
profile without creating, adopting or chmod-repairing it, then requires its exact
localProfileId. On macOS 14+ arm64 it creates a distinct 0700 random empty directory
under `openviking/team-projections/<owner-key>/staging/`, never under private data
or the runtime. Owner keys bind local profile, canonical service, user, team and
team/project scope. Components must be current-user-owned, user-only directories;
symlinks and changed directory identities fail closed. The owner-controlled root
and runtime must not be concurrently modified by another local writer.

Preparation has a 60-second operation deadline and caller-owned cancellation.
`assertCurrent` rechecks that lifetime, profile and directory identities; it is not
a runtime or membership lease. A future launch owner must freshly admit the
production bootstrap/runtime and current authorization before the short permit
exchange. Basic `prepare` returns no bootstrap or launch method, no model setting is decrypted,
and preparation does not mark a projection indexed or searchable. `discard` only
removes the exact original empty run directory; nonempty/replaced directories are
retained with an explicit error, and empty namespace parents may remain. An index
owner must separately manage nonempty staging after confirmed physical worker exit.
The application still does not invoke this preflight or register production permits.

The separate `prepareIndexWorker` composition additionally requires the fixed
`newmoney-team/v1/team_index_worker.py`, `team_model_transport.py` and
`team_model_channel.py` inside that freshly admitted signed runtime tree. Missing,
empty, oversized, writable or symlinked files fail closed and discard only the
empty run. It returns the fixed bootstrap path, not a launch or publication grant.
Developer runtime preparation copies just these three production files before
tree measurement; it excludes probes/tests and never modifies an installed runtime.
The native index job keeps one 240-second monotonic deadline. Each document's
vector-queue wait receives only the remaining job time, rather than a separate
30-second cutoff; document changes never renew the budget. The outer job timeout,
30-second native model exchange, Host/Main authorization deadlines and physical
containment remain enforced. Timeout/incomplete vectors never produce result.json
or a publication success. Diagnostic wrappers are test-only and are not copied
into these admitted production bootstrap files.
An old installation without them remains usable for its existing private path but
cannot perform team indexing. The local installer accepts an explicit
`purpose: "team-index-v1"` for the parallel fixed installation name
`openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64-team-index-v1`.
Both the source and copied staging must pass full signature/tree verification and
the fixed bootstrap checks before publication; a directory suffix is not capability
evidence. Each target has its own exclusive lock and refuses replacement. The
application supplies this distinct `teamInstallationRoot` for preparation and
pre-launch re-admission; missing or invalid team installation never falls back to
private, Lab or artifacts. The lower-level factory's omitted team root preserves
caller-selected single-root compositions, not production fallback. Explicit roots
must not overlap each other or writable state. Private installation, settings and
data remain unchanged. This installs a separate full copy, not a shared mutable tree.
Production signing/distribution, an authorized actual installation and the product
index request entrypoint remain separate work; no automatic upgrade or activation.

Queries have their own `team-query-v1` purpose and fixed installation suffix,
containing `newmoney-team/query/v1/team_query_worker.py` in the signed runtime tree.
The same explicit import transaction verifies source and copy, uses a distinct lock
and never replaces private/index versions. Main application composition supplies
the third root; lower-level omission disables query preparation without fallback.
`teamQuery.prepareRuntime(signal)` verifies signature, full tree, fixed bootstrap
and physical root separation from private/index installations, then returns only
Main-owned Python/bootstrap and `assertLaunchable`. Before spawn that checker repeats
admission under caller lifetime and a fresh 30-second deadline; even a valid signed
replacement with different content invalidates the prepared task. These are checks
of an owner-controlled installation, not an OS sandbox or protection against arbitrary
same-user mutation between the final check and spawn. Preparing creates no index run,
profile, settings or process, resolves no credentials and grants no read/model rights.
The reader's own current scope/receipt/authorization checks remain mandatory.
Fresh developer staging may explicitly select the query bootstrap, before measuring
or signing; existing signed trees are not patched. Actual production signing/import,
query consumer activation and packaged evidence remain separate work.

The index bootstrap implements one bounded, unpublished **vectors-only** rebuild job.
Its only input is an owned 0600 `job.json` in a fresh run directory with the exact
scope-key parent. The strict `newmoney.team-index-job.v1` format carries scopeKey,
explicit embedding/extraction endpoint/model selections and latest canonical
documents (assetId, SHA-256 contentRevision, canonicalContent). It admits no paths,
credentials or arbitrary OpenViking configuration. Limits are 100 unique assets,
2 MiB per body and 8 MiB total job; the pinned local VectorDB requires a dimension
from 4 to 4096 divisible by four. All documents/hashes are checked before storage
or model processing. Larger snapshots require a separately implemented bounded
index owner; they must not be silently truncated or published as complete.

The worker creates `index/` exclusively, initializes the pinned OpenViking core
directly (no HTTP server), uses local RAGFS/VectorDB, disables private extraction,
session auto-commit and watch scheduling, and never resolves default user config.
Both backend clients bind to inherited FD3; Host still authorizes every model
request. A Python audit guard rejects socket connect/bind/DNS fallback; it is not
an OS sandbox for native code. This version writes vectors only, not generated
summaries or private sessions. It requires completed vector status, closes storage,
fsyncs a bounded `newmoney.team-index-result.v1` receipt containing scopeKey and
assetId/contentRevision pairs, and keeps FD3 alive until atomic process exit.
No raw exception or model payload is emitted. Native index failures use fixed exit
codes 71..76 (runtime, input, storage-init, vector-index, storage-close, result-receipt).
Main maps unknown/legacy exits to worker-exit; startup/preflight failures use only
preparation or launch-or-cleanup. The private team-worker-state message permits an
optional fixed failureStage only for failed state. Host preserves that stage in
the bounded error; it is not the upstream cause or proof of model success. The
first failed stage survives secondary storage-close errors. Failure/cancellation cannot be
treated as success even if partial files exist; Main must wait for physical exit
and validate the result against its captured authorized snapshot before any future
publication. Current app startup still has no automatic index publication owner.
The native worker test proves actual file/vector ingestion with synthetic model
responses plus denial/cancellation/hash rejection, not product search, index swap,
real Providers, production bootstrap signing or packaged acceptance.

Main's `teamPreparation.writeIndexJob` now connects the receipt binding's scoped
materialization to the worker file contract. It requires a matching owner key,
caller cancellation, current prepared storage identity and an independently bound
`assertReadable` grant check before/after asynchronous work. It never derives a
grant from historical receipt leases; this read check is not model authorization.
The binding checks retirement throughout replay without exposing its receipt store.
Only latest active bodies are streamed into an exclusive 0600 `job.json`, with
serialized-byte and document limits matching the worker. No raw bodies accumulate
in a whole-snapshot array. Empty/all-revoked snapshots and snapshots not yet at
their captured local head fail explicitly; no truncation, empty-index publication
or cursor advance is inferred. Model fields are copied and credential-bearing
extra properties are not serialized. Errors remove only the originally created
input file after storage-identity checks, retaining foreign/replaced files and
reporting unconfirmed cleanup. `assertStorage` is a cancellation-independent
identity check for this exact cleanup, never read/model/launch permission.

The returned job handle captures the receipt record and expected asset/version set.
`verifyResult` must receive that exact worker's Main-owned physical completion;
failed/cancelled completion, port EOF or Host claims cannot validate output. It
reads only the fixed `result.json`, rejects symlinks/special files and checks stable
file identity with a nonblocking, no-follow, 32 KiB bounded read. The strict schema,
scope and complete unique asset/version set must match the captured job, and read
permission, owner lifetime and local receipt pointer are rechecked around the read.
Acceptance is single-use and returns frozen snapshot/version metadata only, not
`searchable` status or an active-index pointer. Before launch the owner must still
freshly admit runtime/bootstrap; before publication it must separately verify live
server head, authorization/model policy, current generation and the atomic swap.
The current app does not automatically call this handoff or register index jobs.
`TeamWorkerSupervisor.indexJobs` now owns the Main-only scheduling lifecycle from
preparation through verified physical completion. It rejects duplicate exact owner
keys, caps preparing/ready/running index tasks at four, snapshots model selections
and budgets before awaiting, and never coalesces jobs with potentially different
authorization or models. Preparation is bounded to 60 seconds; a ready task has
five seconds to receive an exact Host reservation. It does not manufacture that
reservation or expose a Renderer command. Construction alone performs no indexing.

The existing private receipt broker now admits explicit `shared-knowledge-index-`
`prepare`, `register`, `cancel` and `wait` requests from its exact Host generation.
Preparation requires a current opaque receipt handle; Main derives the local profile,
user/service, scope and read grant from that handle, never caller identity, paths or
self-issued permission. The caller must own a separate handle for the index run and
close it after completion or failure. Only bounded HTTPS endpoint/model selections
and embedding dimension (4–4096, multiple of four) cross this request, never keys,
executable arguments, document bodies or caller-specified budgets. Main selects
100-page/100-asset replay limits and invokes its existing `indexJobs` scheduler with
the application-owned team preparation. It returns only a random `indexId`, not a
model grant, path or searchable state. The Host must then reserve a `worker` phase
channel for the same scope/models, register its UUID against that exact handle and
single-use indexId, and only after registration ACK ask the worker broker to start.
Registration ACK does not mean spawn, completed indexing or publication.

At most four index handoffs remain pending/running or awaiting result consumption;
the scheduler additionally deduplicates the exact owner across different handles.
Duplicate preparation is rejected, not coalesced. Closed/denied/replaced handles
cancel owned work; late preparation cannot return a usable ticket. Slots survive
cancellation until underlying preparation cleanup or physical completion settles.
An explicit `wait` awaits the exact scheduler result, including Main's output-file,
snapshot and version validation. Failed verification returns redacted `INDEX_FAILED`;
a completed result stays observable until consumption/close or its retention deadline. Successful wait returns only
`verified-unpublished`, after rechecking handle lifetime and the read grant. It is
single-use and neither retains an active-index pointer nor publishes/searches output.
Registered staging remains conservatively retained under the existing cleanup policy.

Successful wait now retains that exact result and its publication capability inside
Main, bound to the original handle/indexId; it does not send the capability to Host.
The existing four-index capacity includes retained results and publishing IO. All
registered settled tasks, successful or failed, expire 90 seconds after Main task
settlement (including verification), whether or not wait was consumed. Wait/publish
cannot renew that deadline. Timer plus wall/monotonic checks enforce expiry even
before delayed timer delivery. Close, cancel, identity/Host/power/configuration
invalidation retire the original lifetime and release retained references; publishing
IO retains its slot until settlement. Failed wait and publication attempts consume
the result; successful wait remains single-use.

`shared-knowledge-index-publish` carries only requestId, handleId and indexId. Main
requires successful wait consumption and refuses early, foreign or duplicate use.
The publisher's final callback freshly invokes Main's existing bounded independent
authorization reader, then a Main-installed current-Host head/model observer using
Main-owned owner/models/snapshot and the fresh permission revision. The stored read
grant can renew only after that exact observation succeeds. Explicit read denial
retires every existing/opening handle of that same service/user/team/project scope.
The observer is a trusted composition dependency, not Host-provided request data.
Main now installs a private current-ready-Host client; missing composition still
fails closed before calling the filesystem publisher. No new knowledge/model
networking is added to Main.

`team-index-head-check` sends only exact service/user/team/project, credential-free
model selections, verified epoch/cursor and the fresh Main permission revision.
It never sends localProfileId, filesystem paths, source bodies or credentials.
Host uses its current credential and existing Gateway to authorize that exact scope,
check both model policies and probe one sync page at the supplied cursor. Revision,
scope, epoch or head drift fails closed without persisting the probe or running a
model. Success returns a bounded `validUntil`, not a read grant or remote stream lock.

Main accepts only the matching request from its current ready Host. Successful
observations stay revocable until exact cancellation or expiry; Host sends
`team-index-head-invalidated` on credential, configuration or power retirement.
Workspace model-channel retirement conservatively invalidates all head observations
because this scope-bound request has no Workspace identity. Main additionally retires
observations on settings change, Host replacement/exit/poisoning, power transition
or stop. The synchronous commit checker enforces caller/Host identity plus wall and
monotonic time, including backward clock changes. The bound is the shorter observed
scope/page/credential expiry and 90 seconds from Main's request; it cannot extend the
original index result deadline. Main waits at most 10 seconds for an initial reply;
Host allows 8 seconds for observation IO. Each side admits four observations, with
successful leases still occupying capacity. Host cancellation keeps unfinished IO
slots until settlement, discards late results and releases the observation lifetime.
At its initial 8-second deadline Host aborts the observation and immediately sends
one negative reply, instead of leaving Main waiting for the 10-second fallback.
Caller cancellation and shutdown do not emit a later deadline failure. A negative
reply does not release pending Host IO capacity; late completion still disposes its
observation and cannot send success. The private wire schema is unchanged.

Local diagnostic output uses fixed `new-money.team-head.v1` and
`new-money.team-read.v1` records: total milliseconds and at most three ordered phase
durations. Head phases are authorization, head-probe and validation; body-read
phases are reader-admission, local-body-read and current-check. Results distinguish
observed revision changes, cancellation/timeout and failed phases without guessing
that every authorization failure is a permission denial. Records contain no IDs,
addresses, paths, model names, content, credentials or raw errors. Diagnostics run
once on settlement, never trigger retries/network/model calls, and sink failure
cannot change the operation result. A stuck underlying IO may have no settled
diagnostic even though its caller already received the deadline failure. These
process-local records are not an end-to-end correlated trace or production proof.
Head records use Host stderr (forwarded only with the existing
`PI67_DEBUG_AGENT_STDERR=1` launch option); body-read records use Main stdout.
Normal GUI launch does not persist these records or enable broad stderr forwarding.

Success returns only `published-local` and the committed epoch/cursor, never paths,
manifest, documents or a grant. `PUBLICATION_INDETERMINATE` is valid only for publish
responses and survives concurrent identity/handle loss; a possible commit must not
be rewritten as ordinary `STALE_HANDLE`. Host allows 100 seconds for a publish reply,
without extending Main's deadline, and closes the exact handle on timeout, abort,
shutdown or mismatched response. Those lost-reply errors carry local
`outcome: indeterminate`; closing cannot undo a possible commit. Late replies cannot
revive the request and no retry is automatic. The internal Host index orchestration
now waits, observes head, requests publication and closes. Authorized retrieval and
the user entrypoint remain separate work; receipt sync does not trigger indexing.

Main now verifies the actual fixed `index/` tree, not only `result.json`, after the
exact worker's physical completion. Only owned, private directories and regular,
non-executable, single-link files are accepted on POSIX; symlinks, special files,
empty/zero-byte trees and unsafe names fail closed. Traversal streams entries and
64 KiB file chunks, with ceilings of 4,096 entries, 32 child-directory levels,
256 MiB per file and 512 MiB total, and a 60-second cancellation budget per scan.
These are safety ceilings, not measured capacity or latency promises. Existing
job/owner deadlines and current read authorization still apply.

The Main-only result captures credential-free model selection plus an immutable
content fingerprint/counts. A private checker rehashes bytes and compares file and
directory identity, permissions, links, size and nanosecond modification/change
times; it also revalidates the exact receipt snapshot and current storage/read grant.
Verification performs that second scan before accepting a result. Paths, file lists,
inode details and the checker never enter the Host wait response or Renderer.
This is a change-detecting observation, not an OS lock, protection against a malicious
same-UID process, a durable seal, database-semantic validation or atomic publication.
Verification itself does not copy, chmod, remove or publish files. The one-shot
Host transaction requests publication separately through the private protocol. Native
layout and searchability must be verified separately from synthetic file fixtures.

The verified Main job result now also owns a one-shot internal `publication.publish`
capability; constructing it performs no IO and neither scheduler completion nor a
Host wait invokes it. Its required Main-composed callback must freshly combine Main's
independent read authorization and Host's exact scope/model/head observation and
return a synchronous validity assertion. This callback is not a serialized grant;
the production composition now installs the current-Host observer described above.
The private publish request still refuses to run without that observer.
Main's narrow authorization-only networking exception is unchanged.

The POSIX publication primitive flushes and rehashes every index file and directory
bottom-up. It writes an exclusive 64 KiB-bounded `publication.json` in the original
run, binding scope key, generation, receipt epoch/cursor/record, credential-free
models, document versions and artifact fingerprint. It fsyncs the run/staging
directories and an exclusive temporary pointer, invokes the mandatory fresh
observation, rechecks artifact/snapshot/storage, manifest and current pointer
identity, and atomically renames the pointer to the owner's `current-index.json`.
It then fsyncs the owner directory, reads back and checks lifetime/observation again.
The pointer is at most 2 KiB and contains only schema, owner key, run generation,
manifest hash, epoch and decimal cursor. Paths and credentials are never serialized.

Published generations retain their original `staging/run-*` physical location;
referenced runs are durable generations, not disposable staging. No index copy,
directory rename, permission repair or old-generation deletion is performed. There
is no automatic recovery/retention yet. Existing invalid pointers/manifests fail
closed; a lower cursor or different epoch cannot silently replace the old pointer.
Same-epoch same-cursor rebuilds are allowed after the same full checks. Epoch reset
requires a separate recovery flow, not an implicit rollback of the stream.

Publication has one in-flight operation per canonical owner directory and four
globally, without queuing; slots last through outstanding callback/IO settlement.
Each capability permits one accepted attempt. A 90-second cancellation lifetime
combines the original job, caller and existing artifact-scan limits; cancellation
is cooperative and does not forcibly interrupt an uncooperative callback or fsync.
Pre-rename failure reports `not-published` for that invocation and retains the old
pointer plus any orphan metadata. Once rename starts, any failure is `indeterminate`:
the pointer may already have changed. Never claim rollback, automatically retry or
acknowledge success without durability/readback/current checks. Windows is rejected
until its separate filesystem/target-host contract is implemented and verified.

This operation is process-local coordination, not a filesystem lock against another
Main/OS process, a lock on the remote stream or a persistent authorization grant.
`published-local` alone is not permission to search. Restored and active readers
still need current access, exact scope/model compatibility, live receipt allowlists
and integrity checks. Main now exposes `openIndexReader` only as an internal method
on a current receipt handle. There is no Host/Renderer reader request and no query
worker or search cutover yet; the existing search remains.

The restored-index admission receives memoryRoot/models only from Main. It verifies
the existing localProfileId, exact hashed scope namespace, private owned directory
identities (including receipt roots), bounded pointer/manifest and complete receipt
projection. It does not create/repair a private profile or change/delete index files.
Manifest schema, snapshot/receipt record, all current active asset revisions, both
model routes/dimension and measured artifact digest/counts must match exactly.
It rejects stale epochs/cursors, unprocessed captured heads, empty/over-100 active
sets, malformed or rehashed-but-inconsistent metadata, symlinks and unsafe entries.
Any receipt append conservatively invalidates the entire generation, including when
an unrelated asset changed; partial stale-index fallback is not implemented.

Main obtains a fresh independent read grant before file admission, then after the
heavy scan repeats read plus the installed current-Host model/head observation.
The reader rereads receipt/pointer/manifest, checks storage and rehashes the exact
artifact after that awaited observation. A Main-only lease retains only the exact
generation directory, snapshot, frozen asset-version metadata, cancellation and an
async checker. Paths/checkers are not serialized grants. The checker optionally
validates up to 100 selected asset/revision pairs, rechecks authority and local
snapshot identity, and rehashes bytes before accepting later use. Failures latch
cancellation; restoring permission cannot resurrect that lease. A future query
owner must gate actual file/model execution and result delivery separately.

At most four reader admissions/leases coexist process-wide. The non-renewable
60-second deadline starts before initial authorization and uses timer, wall and
monotonic checks. Caller/binding cancellation and dispose retire the lease; pending
admission/check IO retains its slot until settlement, even after cancellation.
Overlapping checks on the same lease are refused without queueing. Server access
and head are point-in-time observations with their own earlier expiry, not push
revocation or remote locks. File integrity is change detection, not an OS lock.
Receipt replay is capped at 10,000 pages/100,000 version entries; current active
documents are capped at 100 and manifest bytes at 64 KiB. Artifact scans retain the
existing streaming ceilings and cancellation. This is conservative read admission,
not a measured hot query path: batch result validation rather than invoking a full
scan per hit/token. Real query latency, native database read-only behavior and
Windows support remain unverified.

The pinned native OV 0.4.16 ordinary local-collection reopen/query/close path is now
verified unsuitable for direct read-only access to a published generation. Its
PersistentDict initialization rewrites metadata; collection recovery also owns
background maintenance and close-time persistence. The isolated native probe
returned vector hits, observed a write-open on collection metadata and an actual
metadata identity change, then the Main artifact checker rejected reuse. The
probe is diagnostic-only, requires an explicitly marked native-test temporary
generation, denies Python socket operations and uses the worker's private umask.
It is not a query bootstrap, an OS sandbox or a new production runtime admission.
Do not relax integrity checks or silently substitute this mutable API for a
read-only worker. The accepted continuation uses Main-owned disposable working
copies. An internal native vector primitive, managed query runtime preparation and
private one-shot query messages now exist and are composed by the internal Host
metadata-search transaction. Exact body transport is separate below; Renderer search
and Session-bound body consumption are not connected yet.

The internal reader's `withWorkingCopy` is an exclusive bracket under its existing
four-slot/non-renewable 60-second lifetime, not a serialized command or permission
grant. It first revalidates the published source, creates a private unique
`staging/query-*` sibling and streams only `index/` through the existing scanner
into new 0600 files/0700 directories. No hard links, publication metadata, receipt
or private profile are copied. Source identity and content must remain unchanged;
the complete copy digest and counts must match before operation admission. Source
and authority checks repeat before execution and before results may leave Main.
One reader cannot run overlapping copy/check operations. Selected asset/revision
validation and per-request model admission remain separate requirements for the
future query owner; the generic callback return is not authorized model content.

Cancellation/deadline invalidates use immediately, but the bracket retains its
capacity and files until the owner callback settles. That callback must await
physical query-process AND descendant exit, even after rejection/cancellation;
an aborted Promise or signal is not sufficient. The bracket then removes only
its anchored temporary directory, independent of cancellation, and verifies both
parent and copy identity before deletion. Replaced paths cause an observable
failure and retention for exact-path recovery, not recursive deletion of another
owner's data. This is change detection, not a lock against the OS account owner.
The native vector owner composes the existing macOS group supervisor with this
bracket. `NativeTeamWorkerCleanupError` denotes unconfirmed containment, not a
normal query error: Main converts it to `TeamIndexWorkingCopyRetentionError`,
retains the exact copy and reader capacity, retires that reader and blocks further
native vector launches for the Main-process lifetime. No automatic unlock/retry
or remnant deletion is permitted. Other failures still clean only after confirmed
group completion. Quarantine is not an OS-wide fence or a crash-recovery mechanism.

`queryVector` is Main-only and requires an exact Main-supplied runtime admission
callback, interpreter and query bootstrap. It captures the input vector, limit,
model dimension and current asset allowlist before async work; callers must obtain
that vector through the appropriate Host model policy and cannot infer admission
from this primitive. The low-level owner starts a non-renewable 30-second lifetime
before runtime admission, subordinate to the reader's 60-second lifetime. Runtime
admission is followed by current read/head/receipt/source verification before spawn.
Native cleanup may exceed cancellation; no Promise race releases live process data.

FD3 is one-shot and not a model relay in this bootstrap: 4-byte big-endian length,
up to 128 KiB request, 32 KiB result, then one `0x01` Main ACK before normal child
exit. Request schema `newmoney.team-vector-query.v1` contains only scopeKey,
1–100 unique assetIds, 4–4096 finite float32-range vector entries (multiple of four,
exact configured dimension in Main), and limit 1–100. Result schema
`newmoney.team-vector-result.v1` contains at most limit unique permitted asset IDs
and finite scores. Reject extra/trailing frames, malformed UTF-8, arbitrary fields,
unknown assets and oversized data. Partial or acknowledged results remain withheld
until physical process/group completion, source verification and copy cleanup.
No prompt/vector/result file or source bodies are emitted; stdout/stderr remain
discarded. The native schema is independently versioned, not a new Host/Renderer
command or model authorization message.

The pinned worker accepts only an owned private `query-*` directory containing
`index/`, never a retained `run-*`. OV's low-level collection uses encoded paths
and includes automatic directory rows. It must filter exact `/resources/<id>.md`
paths and `account_id=team-<scopeKey>` BEFORE top-k, then check both again; no broad
query followed by dropping directory hits. It preserves the SDK's first-hit order
when deduplicating assets, without assuming a universal score direction. Main maps
IDs to current receipt revisions and rejects stale/foreign results; it does not
read bodies or start a model. Runtime source resides in `team_query_worker.py`,
but it is not added to an existing signed index-v1 tree or automatically installed.
The separate managed query-runtime composition above must supply runtime evidence;
The Host transaction below composes the embedding phase and Main reader; product
consumer/body-access wiring is still required before activation.
Repository bootstrap paths are synthetic-test inputs only, never a runtime fallback.

Copy input limits remain 4096 entries, depth 32, 256 MiB/file and 512 MiB total,
using a 64 KiB streaming buffer; four concurrent copies can therefore add up to
2 GiB of source-sized storage. These limits do not cap later SDK writes, enforce
an OS quota, guarantee operation exit by deadline or cover crash-remnant recovery.
No cross-query cache, automatic retry or crash garbage collection is introduced.
Native synthetic tests confirm successful vector lookup, mutation only in the
working copy, intact source and post-exit cleanup. Large-corpus latency, disk
growth, abrupt-process-death recovery and production/Windows integration remain
unverified; do not promote one small fixture to a product performance budget.

The private receipt protocol now includes `shared-knowledge-index-query-prepare`
with only requestId/handleId, and `shared-knowledge-index-query` with requestId,
handleId, queryId, 4–4096 finite float32-range vector entries (multiple of four) and
limit 1–100. Both reject additional fields. Main alone chooses the memory root and
admitted query runtime. Its reader may omit an externally selected model tuple:
the validated publication then supplies frozen models, still checked by the exact
current-Host head/model observer. Supplying expected models retains the previous
strict matching behavior. No model metadata is returned before full reader admission.

Host query failure messages preserve a fixed phase (`receipt-open`, `index-preparation`,
`embedding`, `native-query`, `receipt-close`) through the Session query owner. These
are locally selected transaction boundaries, not upstream error text or additional
IPC fields. They contain no identities, paths, credentials, queries or body bytes.
Cancellation and failed cleanup retain the primary failure's phase; a close-stage
error still withholds all hits. Phase labels do not prove Main's failing substage,
the underlying cause, successful cleanup or physical native completion.

`TeamIndexQuerySessions` holds up to four entries per broker and exactly one query
preparation per dedicated receipt handle. Preparation first admits runtime, opens
the reader and checks it; response contains only opaque queryId, embedding model
and snapshot. Query consumes that ID once, passes the vector to the existing reader
with Main's admitted runtime, and withholds assetId/contentRevision/score hits until
native completion, working-copy cleanup and final reader version checks. Its only
metadata response is the captured snapshot; no bodies, paths, executable selection,
private identity, credentials or serialized permission grant. The reader's process-wide
four-slot policy and unconfirmed-exit quarantine/retention still apply independently.

One timer plus wall/monotonic checks bounds preparation/idle/execution to 60 seconds;
waiting does not renew it. Receipt close, identity/Host invalidation and reader expiry
cancel it. Busy preparation/execution retains the entry until its promise settles,
so closing cannot admit a replacement while underlying work is still outstanding.
An active index job cannot share this handle; receipt mutations are refused while a
query owns it. Host receipt client snapshots the vector before sending, waits up to
70 seconds per query phase and closes the exact receipt on timeout/cancel/operation
mismatch. Late responses cannot revive a completed client request. No retry or search
fallback is added. Read/head checks remain bounded observations, not remote locks.
The Main application installs this private composition. The Host now adds an internal
`AgentHostServer.teamKnowledge.search` entry through its existing enterprise controller; it is not a
Renderer command, Pi Tool, Session authority or automatic embedding trigger.
`EnterpriseTeamQueries` owns a shared four-run limit for embedding-only and complete
search work, from credential/configuration admission through receipt close. Settings,
caller, credential generation, Workspace retirement, power and shutdown invalidate
the original run. A non-renewable 60-second cancellation budget plus wall/monotonic
checks and credential expiry cover the whole transaction, not each phase separately.

`runSharedKnowledgeQuery` snapshots the selected scope/text/limit, opens one dedicated
receipt, prepares Main's current query runtime/index, and only then resolves the
configured embedding source. The exact endpoint/model/dimension must match Main's
selection. The existing per-request team/project embedding policy guard remains
mandatory before provider IO; no extraction model, session body, fallback or retry.
Only the returned vector is sent to Main. A successful metadata response must match
the prepared snapshot and requested limit; Host copies its ID/revision/score hits,
awaits successful exact handle close and checks its current lifetime before returning.
Cancellation requests close immediately, including while a model transport drains;
the owner holds its slot until that underlying model work settles. Receipt-client
cancellation can reject before native exit; Main independently holds its reader/query
capacity and copy until physical settlement. Close acknowledgement is not exit proof.
Neither cleanup nor return grants subsequent body access or model processing. New
results require a new explicit transaction; no implicit indexing, sync or search
cutover. Synthetic Host/transport/message tests, Main file tests and source-bootstrap
native tests are separate evidence, not a signed-package/real-account end-to-end proof.

The private `shared-knowledge-index-read` request carries requestId, dedicated handleId,
positive epoch/cursor snapshot, assetId and contentRevision only. Main uses its configured
memory root, not an input path or executable. `TeamIndexQuerySessions.read` shares the
four-entry limit with preparation/query work and rejects handle reuse while busy. It
opens a new published reader without preparing query runtime, requires snapshot equality,
calls `readDocument` for the exact version, rechecks reader validity and disposes it on
every settled path. Cancellation/close retains pending read entries until IO settles;
identity/Host invalidation retires the same binding. Its 60-second bound cancels work,
not proof that uncooperative filesystem IO has already stopped.

`readDocument` checks Main's active manifest allowlist and revalidates storage, receipt,
publication, artifact and current read/head observations before replay and after it.
It reuses canonical receipt materialization, which checks hashes and suppresses revoked
or superseded versions. The callback retains at most one selected canonical string;
no partial body is returned if full replay/final checks fail. Limits remain 10,000
receipt pages/100,000 historical asset IDs and at most 100 active published documents.
This bounded replay is not a body cache, constant-time lookup or large-corpus performance
claim. No query copy, native process, model call or additional body file is created.

The reply contains only the matching snapshot, assetId/contentRevision and at most
1 MiB of canonical UTF-8 content; no credentials, profile/path or read/model grant.
The internal `AgentHostServer.teamKnowledge.read` composition uses the existing Host
four-operation/60-second owner with captured credential/settings/Workspace/power lifetime,
and `runSharedKnowledgeRead` performs fresh open→read→close. It matches every response
identity/version field and reuses `decodeKnowledgeCanonicalContent` with SHA-256 before
returning parsed kind/title/summary/body. A successful close and final current-lifetime
check are mandatory. The private client grants 70 seconds for read reply and closes on
timeout/cancel/shutdown; that close does not prove Main replay stopped. No fallback or
retry is added. Independent Main admission remains required; Host does not self-issue
read permission. These callbacks are internal, not Pi Tools or Renderer routes. They
do not establish prior search selection in the current Session, provenance, or permission
to send text to an agent model. Those gates and conversion from canonical documents to
the product-facing knowledge contract remain required before replacing legacy consumers.

`AgentHostServer.teamKnowledge.session.search/read` are explicit internal entry points
with an additional Agent-purpose authorization gate. They capture a caller-supplied
typed birth identity and exact Agent endpoint/model before awaiting, derive team-wide
or project scope from that identity, and reject a current credential user/service
mismatch. Using the same captured credential as the ensuing Main transaction, Host
freshly authorizes the birth project and Agent policy before any receipt open or paid
embedding. Team-wide access still requires a currently authorized birth project;
it is an explicit scope, never fallback from a denied project. Main independently
admits the requested content scope and the embedding phase retains its separate
purpose/model authorization. Body reads do not load embedding settings or invoke models.
The Agent lease bounds cancellation and is checked through confirmed close and return.
Credential/settings/power/Workspace retirement and the existing four-slot/60-second
owner cover authorization and IO; cancellation holds capacity until underlying work
settles. No automatic renewal, fallback, new grant store or Pi loop is introduced.
These typed internal inputs alone are not proof of real Pi birth identity, search
selection or historical asset provenance. The Pi adapter below supplies those checks;
older internal transports do not gain model authorization merely because these
separate entry points exist.

Main's separate `PI67_CANONICAL_TEAM_KNOWLEDGE` selection (not inherited shell state)
is strictly parsed by the formal Host entry. Main selects it only when the supported
local composition and profile initialization succeeded. `canonicalTeamKnowledgeTools`
plus the settings port pass Workspace-bound `teamKnowledgeAccess` through
TaskRuntimeRegistry and PiSdkRuntime's initial, replacement and child Tool factories.
This route does not depend on or enable managed private memory; missing settings
ports disable it. Discovery does not probe models, launch native workers, authorize
access or certify index/runtime readiness. Existing per-use checks remain mandatory.
Team query, embedding and body-read admission reject disabled/off memory before
credentials or receipt/model work. Configuration updates retire in-flight operations;
read-only memory continues to allow otherwise authorized reads.
The canonical `viking_team_search/read` tools use the existing Session wrapper,
birth identity and Agent model; private/malformed Sessions fail before Host access.
Search requires explicit team/project scope and at most five hits, captures a single
latest transient selection, and returns IDs/revisions/scores. Read accepts only a
selected ID, carries its captured scope/snapshot/revision and returns canonical
kind/title/summary/body. A runtime with the canonical access port registers only
these two shared-knowledge tools; it does not also register legacy Experience/SOP
tools. Local errors never change the selected tool family. Without the canonical
port, the legacy compatibility family is unchanged. Legacy readers remain wired
for authorized historical replay, not model-selectable fallback. There is no body
cache, automatic fallback or source conversion. Exact SDK Tool identity and bounded input contracts
use the existing read-safety profile; same-name third-party tools fail closed.
Tool Results carry provider `newmoney-team-knowledge`, untrusted details and deterministic
JSON text. History validation checks text/details consistency, bounded references,
snapshot shape and document identity across all Pi entries before model admission.
It revalidates deduplicated same revisions through the current authorized read path;
changed/revoked documents, missing ports, malformed/unresolved/error results block
processing. Both canonical names participate in the private-capture provenance fence.

Private `shared-knowledge-index-read-current` accepts only request/handle/asset IDs and
content revision; it cannot select a snapshot/path/profile/grant. Its distinct result
returns the admitted current snapshot and the same bounded canonical body as exact
read. Main reuses the four-slot read owner, independent head/read/model checks and
receipt replay; no Python/query/model call occurs. Host matches operation and exact
revision, hashes/decodes content and requires close/current lifetime. The existing
70-second reply margin and cancellation cleanup apply. This prevents unrelated index
updates from invalidating an unchanged historical reference without accepting a newer
asset revision. Default application activation and packaged combined evidence remain
pending; opt-in wiring and source tests do not certify installed-product readiness.

Host receipt IO keeps its existing short timeout. Index preparation waits at most
70 seconds (Main's 60-second bound plus reply margin) without holding a model-port
reservation; result wait is capped at 400 seconds to cover the separate preflight,
running and physical cleanup phases. Timeout/caller abort/shutdown/response mismatch
closes the exact index handle; late responses do not revive it. This is not a new
worker deadline or a model authorization extension. Ordinary receipt sync never
requests these operations. Host now exposes an internal `indexKnowledge` owner
through its enterprise controller. It captures scope/model selections before any
await, verifies current service credentials and both configured embedding/extraction
policy selections before opening an index-specific receipt handle, and delegates
open→prepare→reserve→register→start/wait→early head check→publish→close to
`runSharedKnowledgeIndex`.
Initial policy admission is bounded to eight seconds; it is not cached permission
for subsequent model frames. Reservation always uses the same captured selection
through the existing enterprise `worker`-phase admission and per-frame model guard.
Heavy preparation precedes reservation; no network/configuration/model setup is
inserted into the short prepare-to-register handoff. Before this index-specific
handle is opened, the owner now performs exact-scope receipt catch-up with the same
captured credential, using `syncSharedKnowledge` and a separate sync handle. Its
60-second/10-page cap is inside the existing total transaction budget and capacity.
The original policy grant and lifetime are rechecked after acknowledged catch-up
and confirmed handle close, before any index preparation/reservation. A partial
sync, close failure or cancellation blocks construction; acknowledged pages remain
available for a later explicit request. This adds no automatic retry, startup/login
job, model call during sync or readiness claim; final publication still checks head.
The app-scoped `enterprise.knowledge.index` command exposes this owner through
`dispatchHostAppCommand` with only team/project selection and request cancellation.
It bypasses configuration mutation and does not load the Pi agent runtime. Host
injects `teamKnowledge.index`; callers cannot select paths, runtime, credentials or
models. A 510-second ACK budget accommodates the owner and cleanup margin; it is
not replay-safe. Indeterminate publication retains a non-recoverable protocol error
with `details.outcome=indeterminate`. Renderer offers an explicit cost-disclosed
action, suppresses duplicate sync/build requests, cancels on scope/unmount and drops
late replies. Its last result is not an index readiness or authorization cache.

The Host owner caps in-flight index transactions at four, including initial
configuration/authorization and cleanup, and supplies a 480-second cancellation
budget. This does not extend Main/worker/receipt deadlines or forcibly interrupt
uncooperative IO. Identity/credential, caller, power, shutdown and configuration
retirement also cancel work before a model reservation exists; Workspace rebinding
cancels matching Workspace runs. Slots are retained until the transaction settles.
Main remains the physical containment owner when the Host/credential channel is lost.
Main verification is observed before startup is requested and alongside the worker
completion, so an early failure cancels a still-starting worker. Cleanup drains an
issued startup and existing Main wait, stops the reservation/worker and closes the
dedicated handle. A successful return requires both `completed` from the worker and
Main's `verified-unpublished`, followed by an exact `published-local` acknowledgement
matching that verified epoch/cursor, plus a confirmed handle close and current caller
lifetime. Port EOF, startup ACK, Main-only success with a cancelled worker or a lost
close ACK cannot produce success. Neither cancellation nor a failure response claims
that unconfirmed physical cleanup succeeded; Main retains its existing strict gate.
Only the exact handle/index IDs are sent to publish. A failed early observation
never requests publication; passing it cannot bypass Main's independent read and
current-Host observation at the actual commit boundary. No publication retry occurs.
From dispatch onward, a lost/mismatched reply, wrong committed snapshot, explicit
`PUBLICATION_INDETERMINATE`, or failure of cleanup/current-lifetime/final observation
after a successful acknowledgement rejects with `outcome: indeterminate`. This is
the operation's conservative outcome, not a claim that the pointer was unchanged.
Best-effort cancellation/close, including a cleanup error, cannot overwrite it or
undo a possible commit. An exact Main non-indeterminate failure remains an ordinary
failure. A successful return contains only `published-local` and its exact snapshot;
it is neither a persistent access grant nor permission to search.

The Main wait response also contains the exact verified snapshot's non-null epoch
and positive decimal cursor, not the earlier open-handle progress, paths, documents
or a grant. After both completion witnesses, the Host must freshly authorize the
captured team/project scope and both selected models. It probes the existing sync
endpoint at that exact snapshot with `limit=1`, under a combined eight-second
request cancellation budget. Success requires the same epoch, no changes/no more
pages, and next/head cursors both equal to the verified cursor. A newer valid page,
reset, denial, malformed/expired response or cancellation fails; this probe is never
appended to receipts and cannot implicitly sync, rebuild, retry, call a model or
publish. The existing bounded decoder/transport still owns response validation.

The observation's validity is bounded by fresh model authorization and the probe
page lease, with receipt-time and monotonic caps. It must remain valid across the
dedicated handle close; cleanup cannot turn an expired result into success. The
request-only cancellation timer does not become a new reusable permission grant.
This is a post-index point-in-time observation, not a lock on the remote stream,
an active-index pointer, atomic publication or proof that the content is searchable.
The Main publication owner additionally performs local snapshot/artifact checks and
a new authorization/head decision at its own commit boundary; old hosted search
must remain until that end-to-end cutover is verified.

The internal owner accepts either an explicit model selection/invoke pair or a
Host-only `loadModels(signal)` source. Resolution runs after signed-in credential
admission and inside the same four-run/cancellation lifetime, before model-policy
admission and receipt preparation. A late source result cannot outlive retirement.
`createTeamIndexModelSource` captures an explicit embedding settings snapshot and Pi
extraction selection. It resolves extraction through the existing Pi catalog/auth
resolver, with a 15-second cancellation deadline; it never rereads auth.json or
creates a Provider adapter. It refuses OAuth/subscription/custom execution/header
requirements unsupported by the memory adapter. The narrower team-job HTTPS/model-ID
and dimension contract is checked without changing private-memory settings. Returned
model metadata contains no keys; the Host invoke closure owns the captured credentials.
The resolution deadline does not become the subsequent request lifetime.

The memory transport posts only to the captured base URL plus `/embeddings` or
`/chat/completions`, with the corresponding key, no cookies, redirects, retries or
fallback. Native cannot choose request paths or headers. Every call still passes
the existing fresh enterprise scope/model guard. Responses are bounded to 2 MiB
while reading decoded bytes, independently of Content-Length, and success requires
JSON content type. Error bodies are cancelled without being forwarded; transport
exceptions are generic and response headers never reach the worker. Cancellation
aborts fetch and cancels a pending reader; it does not prove a remote provider
stopped processing a request already received. This is the OpenViking memory
transport, not a second Agent model router or Pi Provider implementation.

`team-index-settings-read/cancel/result/invalidated` is a private utility-process
parent protocol, not a Renderer command/event or native-worker message. A read carries
only a UUID correlation ID. Main reads the existing encrypted settings store on demand
and sends a validated snapshot only to the same current ready, non-poisoned Host with
completed credential bootstrap; suspended/stopping/replaced Hosts receive no secrets.
There is no new credential file or extraction-key copy: extraction remains a Pi
selection, resolved in Host. Private-only settings incompatible with the team-job
contract produce a generic failure, not conversion or a fallback.

Both peers cap pending reads at four. Main has a five-second cancellation deadline and
holds capacity until underlying IO settles, including after cancellation/retirement;
Host has an eight-second wait and sends exact-request cancellation on abort/timeout.
Duplicate Main correlation IDs are ignored; late or malformed responses cannot satisfy
another Host request. Filesystem reads themselves are not forcibly interrupted.
An accepted valid store save first queues the write, then rotates an in-memory signal
and retires its predecessor, even if persistence subsequently fails. Listener reads
therefore queue behind the attempted write. Invalid input does not rotate the signal;
failed persistence does not silently overwrite the last saved settings.

Main observes that signal after the first settings request, invalidates team worker
and receipt resources locally, and notifies the current Host. Host invalidation retires
pending reads and the lifetime of already-resolved settings. Restart, shutdown, poison
and power transitions retire pending Main reads; shutdown detaches the store observer.
The production `AgentHostServer.teamKnowledge.index` internal composition includes the
settings signal in the whole index owner lifetime, loads through this client and then
uses the Pi-backed model source. No key is placed in the receipt/worker job. Private
OpenViking remains configured on its next start; its runtime is not restarted by this
team-settings invalidation. Out-of-band encrypted-file edits are not watched live;
normal writes use the settings store/controller, and later reads revalidate the file.

The internal `AgentHostServer.teamKnowledge.embed` uses that same settings client and
invalidation lifetime but reads only its embedding selection; the extraction Pi
selection is not resolved or invoked. It is not exposed through a Renderer command
or native-worker input. The trusted search owner supplies query text and the exact
expected index endpoint/model/dimension. The complete `teamKnowledge.search` path
gets that selection from Main's admitted reader, not its caller. Host captures the
selection before awaiting embedding settings,
admits signed-in identity, checks model equality, then freshly authorizes each exact
team/project embedding request through `runSharedMemoryModelRequest`. An extraction
or agent policy cannot grant embedding, and project denial never retries team scope.

`createTeamQueryEmbedding` accepts one nonblank, lossless Unicode query up to 8192
UTF-8 bytes, not Session histories or asset bodies. It uses the existing team HTTPS
transport via an embedding-only credential closure which cannot invoke extraction.
The request contains only the configured `model`, `input: [query]` and
`encoding_format: "float"`; no dimension conversion or provider fallback is attempted.
The service authorization request receives no query text. Provider output still has
the shared 2 MiB decoded-stream ceiling and JSON/content-type/redirect protections.
Require HTTP 200, valid UTF-8/JSON, exact response model, one data row with index 0,
and a finite float32-range numeric vector of exactly the configured 4–4096 dimension
(multiple of four). Return a frozen vector and credential-free model metadata; reject
aliases, missing model metadata, extra vectors, base64 output, nonfinite values and
dimension mismatches with a generic error. No provider error body is forwarded.

The Host owner caps query runs at four, cancels at 60 seconds or earlier credential/
grant expiry, and retires work on caller, credential, configuration, relevant workspace
rebind, power or Host shutdown. Settings invalidation is included before the first
await. Recheck after loading and model completion; late results are discarded. Slots
remain held until underlying loading/model transport settles, even if a provider
ignores abort; do not confuse cancellation delivery with physical/remote completion.
This embedding phase neither reads index bodies nor starts a native worker, returns
a reusable authorization grant, persists text/vectors or authorizes model processing
of shared search results. The complete internal metadata transaction is wired above;
product search IPC/provenance/body-processing remain pending, and existing hosted
search is unchanged.

The user command/UI and publication/search cutover remain unwired. No user data or
paid model requests are exercised by synthetic store/parent/Pi/HTTP-stream tests;
those tests do not attest installed runtime or packaged end-to-end behavior.

Caller cancellation, receipt-binding retirement (including credential replacement),
exact Host exit, supervisor invalidation/power/restart and shutdown retire pending
as well as active work. Scope slots are held until outstanding preparation or Main
physical completion settles, so a late cancelled job cannot overlap its replacement.
Shutdown waits for those owners. If work fails before permit registration, cleanup removes
only the exact job input and empty original run; after registration, staging is
retained conservatively, never recursively erased or declared published. Unconfirmed
pre-permit cleanup is observable and blocks new index preparation in that owner.

An index permit supplies Main's pre-launch callback in the 60-second preflight phase: reload and verify the signed
runtime tree against the originally selected runtime, recheck fixed bootstrap,
current receipt snapshot, read grant, Host and lifetime before spawn. Even a newly
valid signature cannot silently switch an already prepared task to another tree.
The Host holds an inactive reservation during this check, then starts its existing
five-second port/start window on Main's `prepared` receipt. Full verification stays
immediately before native launch, without caching trust across jobs or weakening
the ordinary port deadline. Every phase remains bounded and cancelled on owner
invalidation. Synthetic scheduling tests do not establish a production performance
budget or readiness. A preflight refusal does not claim
that a child was launched or poison physical containment; an actual native launch
or cleanup failure remains sticky. Index completion always uses the exact permit's
physical receipt and result validator, not Host EOF. It returns unpublished metadata,
not a live-head/permission lease, searchable cursor or an atomic index swap.
The native index test now feeds real persisted receipt materialization through this
Main writer, the Python worker and Main result validation. Main/Host remain in the
Node test process, with synthetic authorization/model responses and isolated files;
it now passes through the scheduler and Main permit too, but runtime admission,
Host reservation and the model relay attachment are fixture-supplied. This is not
production startup, real service authorization or publication evidence.

The opt-in three-process Electron worker probe now covers Main registration and
launch, a real utility Host using the enterprise controller, and the pinned Python
OpenViking embedder through FD/MessagePort relay. Synthetic credentials, grants and
model responses cover success, authorization denial, caller cancellation and Host
exit, with fresh absent-process-group checks. It also exercises actual runtime
measurement/admission with an ephemeral test signature and isolated preparation,
then discards empty staging only after worker and utility cleanup. It does not
alter or adopt the runtime installation or attest production trust/bootstrap.
This is combined native lifecycle evidence, but not the product Host entrypoint,
production-signed installation, real Provider,
knowledge ingestion, index publication, minimum-OS or Windows acceptance.
The worker probe also freshly admits the actual test runtime during Main preflight
and adds a six-second delay in its success scenario to exercise a preparation longer
than the old five-second window. Successful phase ordering, physical cleanup and
Host admission are required; this deliberate delay is a timeout regression scenario,
not a startup latency or release performance measurement.

Synthetic macOS probes exercise this Main-owned adapter with the Host controller
in the same test process over real Node MessagePorts and a separate pinned Python
worker, including surviving descendants. These lower-level probes remain distinct
from the opt-in three-process worker probe and product end-to-end acceptance. Signed team bootstrap
packaging, a product worker startup route, index publication and Windows containment
remain unverified.

New Money hosted collaboration is an external product boundary rather than a new
Desktop process. Renderer sends typed `enterprise.*` commands through the existing
MessagePort. Its shared, non-persistent account presentation cache consumes
`enterprise.identity.get` and device auth results, deduplicates concurrent reads
(`refresh: true` explicitly supersedes passive reads and fetches `/v1/agent/identity`)
and rejects stale reads after account mutations/disconnection. It contains no
credentials and is not an authorization grant. Footer rendering does not start
the Host merely to check identity; connected surfaces refresh on mount/focus,
using local reads only. Host profile refresh validates the returned user and fences
logout, replacement login, endpoint changes and overlapping profile requests.
Profile refresh serializes with credential mutations. A validated store request with
`profileOnly: true` updates only displayName in Main's existing encrypted store;
every other credential field must match the persisted credential atomically in its
write queue. Missing/rotated/cleared credentials fail closed. Main and Host preserve
receipt bindings and lifetime signals on this cosmetic path. Acknowledged names
survive restart; no team/account authorization changes or new credential grants occur.
Account settings explicitly loads state on entry. Agent Host still owns all
team/project/model checks. Renderer sends business commands through the existing
MessagePort; Agent Host performs business HTTPS calls. One narrow, user-approved
exception allows Main to GET the current signed-in service's team/project authorization
endpoint before receipt persistence. Main reloads secure-store credentials, matches
the bound user/service, rejects expired credentials and accepts HTTPS only, without
redirect, refresh, retry or fallback. Responses are capped at 128 KiB while streaming;
broker timeout/identity invalidation cancels the request. Main checks exact scope,
role, permission revision and a maximum five-minute wall/monotonic lease also bounded
by credential expiry. Its receipt-only grant does not consume or grant model policy.
The application configures this processor for the supported local-memory platform,
using the stable local profile and a separate team-projections/receipts directory.
Host sync scheduling and local indexing remain separate work. `enterprise.team.list` returns
the current user's memberships, while project listing and Workspace get/bind always
carry an explicit `teamId`. Team summaries carry optional boolean `quotasExempt`:
Host rejects non-boolean values and maps absence from older services to false;
the validated Renderer result preserves it solely for commercial-quota display.
Numeric fallback limits remain compatible. The flag is not an authorization grant
and never bypasses entitlement, project or model-policy checks.
Agent Host validates returned Team/Project identity
before caching a binding. Access and rotating refresh tokens remain in Main-owned
secure storage and never enter Renderer. Credential refresh captures the current
authorization generation; begin/disconnect/shutdown invalidate it. Check before
and after the serialized secure-store acknowledgement, clearing an obsolete write
before a newer mutation can run. Late refresh cannot return an active credential.
Disconnect blocks local credential access immediately and revokes only its captured
credential, without refreshing; a superseded disconnect cannot clear a newer login.
This does not yet enforce read-only team history or cancel existing model requests.
EnterpriseContextController additionally invalidates shared request generations on
begin/disconnect/shutdown and clears cached Workspace bindings. Rebinding invalidates
that Workspace's pending requests before contacting the service. Binding responses
check their generation before cache writes; cached binding reads still require active
credentials. Shared Experience/SOP search/read verify generation and exact cached
binding before returning, including after asynchronous feedback and observation.
This is a Host request-lifetime guard, not durable Pi Session provenance or a server
membership lease. Already admitted conversation content remains a pending boundary.
Shared Experience/SOP entrypoints additionally call the exact-project authorization
endpoint before content transport. The Host parser validates current user/team/project,
role, revision, bounded policy rules and lease timestamps. A captured deadline is
the earlier of server expiry and request-start plus granted duration (at most five
minutes); it is checked again before result return. Authorization is fetched per
read, not cached or silently renewed for an in-flight request. Observed wall-clock
rollback invalidates the snapshot permanently. Host records both wall and
monotonic clocks before transport; elapsed request time consumes the grant even if
wall time stalls or moves. Expiry by either clock latches invalidation, so changing
system time cannot revive an expired snapshot. A new request must reauthorize.
Endpoint absence or
denial fails closed. Model-facing shared Tools capture Pi ExtensionContext.model's
baseUrl/id per request; the Host Tool adapter maps missing identity to explicit null,
never the governance-read path. Before content transport, the same lease must grant
the canonical endpoint and exact model ID for agent purpose (not extraction or
embedding). Empty policy denies; no model/provider fallback occurs. Direct user
governance reads still require scope authorization, not an agent model grant.
Periodic refresh, model admission for existing conversation history and sync/index
freshness are not yet implemented by this admission layer.
SessionSemanticTitleGenerator separately requires verified private provenance before
its direct ModelRuntime completion and rechecks before persisting success or failure.
Automatic generation skips unverified history; manual regeneration rejects without
sending context. Local title projection and manual naming do not call a model.
This is an independent title boundary, not general provider-request admission.
The inline shared-history transition extension uses explicit cancel results for
Pi session_before_compact/fork/tree events; a failed provenance read also cancels,
because Pi swallows ordinary handler exceptions. It checks full entries rather than
the active branch. Shared tool history and non-private/invalid/inherited Desktop
markers block transitions; unmarked legacy history retains compatibility, not a
private ownership grant. Cross-runtime fork checks source JSONL before child creation.
Desktop propagates tree cancellation without publishing successful rollback events.
This migration fence does not intercept arbitrary extension-owned requests or the
Agent's normal continuation loop, and does not implement a verified team Session grant.
RuntimeSessionBindings separately installs an idempotent guard on the public Pi Agent
streamFunction for bound and child Sessions. Each call checks full current Session
entries immediately before delegating unchanged arguments to Pi's original transport.
Shared or invalid/inherited Desktop provenance throws before delegation; Pi terminates
that loop with an error message/event, not a rejected prompt Promise. This also checks
the iteration after shared Tool execution. Unmarked legacy remains compatible and is
not certified private. Team authorization is not yet implemented: a shared retrieval
grant alone cannot unblock this guard. Credential resolution precedes this seam;
in-flight revocation and arbitrary extension-owned requests remain separate work.
Initial creation with a creationId now runs its setup before Desktop binding and
extension session startup: initialize private provenance, persist the exact creation
marker, then bind the Session and record the creation receipt. Setup failure disposes
the unbound Pi Session without claiming publication; durable marker/journal recovery
remains authoritative. Explicit team birth uses the scope-specific setup below.
Explicit session.create.teamScope now carries only teamId/projectId, through both
fresh Task bootstrap and existing-runtime create. Runtime requests Host authorization
before creation side effects; Host uses current credentials and exact-project scope,
not Workspace binding, and returns a short-lived birth grant with derived user/endpoint.
Renderer immediate creation can now pass this explicit scope: copy teamId/projectId
before asynchronous connection recovery, retain the selected Workspace checks, and
send them with the exact creationId in a separate Task. Rejection never falls back to
private creation. Provisional intent can also carry teamId/projectId through the
existing encrypted composer-draft envelope to restored first-send creation. Main
validates exact bounded scope keys on provisional records only, rejects malformed
scope rather than stripping it, and stores no permission grant. Renderer snapshots
scope before connection recovery, rejects drift and stale cross-scope draft restore,
and drops creation intent once the conversation materializes; Pi JSONL remains truth.
SessionSnapshot.memoryOrigin is a read-only projection of validated full-history
provenance: private, team with teamId/projectId, or unverified. It carries no userId,
endpoint or lease and grants no access. Missing fields in older snapshots are
unverified. Login, Workspace binding and draft state cannot establish this origin.
The provisional selector loads teams/projects on explicit disclosure and opens a
separate scoped draft; it never mutates a materialized Session or copies private
draft content. Live origin display uses the Session identity projection, not login
or draft data. Omitted creation intent still creates private.
Model-facing shared Experience/SOP reads resolve team/project from the Runtime's
birth identity, checking current user/service and exact project/model authorization.
They do not query or mutate Workspace binding. Model-free governance retains bound
Workspace scope; a missing selected model is still denied by model policy. Existing
generation/power guards, content scope/revision checks and SOP expiry remain active.
Shared observation item hashes and feedback lookup bind canonical endpoint, user,
team and project, plus provider/asset identity. Both governance and model reads
pass their resolved scope. Existing unscoped records remain readable but cannot
alter scoped ranking; no plaintext identity or data migration is added.
Setup writes kind=team plus originSessionId/userId/teamId/projectId/endpoint in the Pi
provenance entry before startup; no existing provenance or message history is adopted.
Grant validity is checked at setup and publication; only identity is persisted, never
credentials or a reusable permission grant. No authorization port means rejection.
Current model/transition/private-memory guards continue to reject team markers: team
creation UI, per-model authorization, renewable leases and scope-bound retrieval remain
pending. A creationId replay cannot create a second Session or replace its scope.
Shared Tool factories now read exactly one version-1 team identity from full Pi
entries, bound to this Session ID with no inherited header; bounded IDs and a safe
canonical service URL are required. The identity is attached to the current model
for all Experience/SOP search/read calls, never accepted from model Tool arguments.
Host compares it with current credential user, configured service and bound team/
project before authorization or content access. Binding mismatch fails instead of
retargeting the Session. Successful identity admission leaves the sole team marker
unchanged; malformed/private attempts retain the conservative unverified restriction.
User governance reads are not model Tool calls. Main/child Agent stream admission
now passes the actual request's base URL/model ID to the Host authorization port.
Host checks current project membership/entitlement and the Agent model policy; the
returned user/service/team/project must equal immutable birth identity. Full Pi
entries supply shared Tool Result details (asset ID/project/revision); identical
references are deduplicated and reread through the current authorized detail path.
Any access denial, version mismatch, missing metadata, unresolved shared call,
shared error result or unproven derived summary blocks transport. Abort/history
changes during checks also block it; SOP expiry and the grant are rechecked before
admission. No replacement revision, model fallback or second Pi loop is introduced.
This is per-request admission, not background lease refresh,
immutable synchronization, title/compaction/fork admission or team creation UI.
Admitted streams retain a live assertion of the current Host grant and historical
SOP expiries. A one-second idle timer and every incoming Pi event check validity;
Session replacement also invalidates the request. Known failure aborts a linked
provider signal and emits a terminal Pi error without Tool content, so late provider
events cannot authorize Tools or revive the loop. Caller abort is preserved as an
aborted result; normal terminal events preserve provider metadata/usage and remove
the timer and listener. Private transport is not wrapped. Remote compute cancellation
requires provider cooperation and transmitted data cannot be recalled. During an
active model stream, monotonic one-minute scheduling performs single-flight full
history reauthorization. A new grant replaces the old one only after all references
pass and the old grant is still valid. Only branded RuntimeError transport failures
with `kind: enterprise-transport-unavailable` retain the existing unexpired lease;
generic recoverability is not enough. Network errors and HTTP 408/429/5xx receive
that classification; denials/invalid responses do not. HTTP status is processed
before an error body can fail or stall. Explicit refusal or changed revisions stop
the request. Cleanup aborts the refresh signal through Host to the gateway, and late
results cannot renew a closed/expired request. This is not idle/whole-Task renewal,
push revocation, explicit wake-before-resume admission or immutable synchronization.
Main sends strict `enterprise-power-transition` suspend/resume messages directly to
the utility parent channel. It retains state without eagerly starting Host and sends
the latest state on readiness before renderer port handoff. Host owns a transient,
non-persisted power epoch: receipt invalidates all prior team grants and pending
shared-read admission; suspend prevents new grants. Resume opens fresh admission
but cannot restore old grants. Stream lease assertions observe that invalidation.
No credential/profile reset or private runtime restart is involved. Renderer resume
resync remains separate. The fence begins at Host receipt; native OS/IPC ordering and
real resumed-network-packet races are not yet verified, and whole-Task fencing is pending.
Native subagent spawn/resume/steer rejects a shared/team parent before admission
or child creation; a fresh child must not launder team-derived task text. Existing
status/wait/stop paths remain available. Child inheritance authorization is pending.
The Host gateway admits search/detail assets only with the requested kind,
`status: active` and explicit `revokedAt: null`; the server detail endpoint also
serves governance history, so a successful HTTP response is not active-content
authorization. SOP parsing rejects expiry at or before now, and Host rechecks
expiry after asynchronous work before returning search/detail results. This is
read-time admission, not durable historical-revision authorization or in-flight
model cancellation. Server governance/history responses remain unchanged.
RuntimeSessionBindings initializes `pi67.memory-provenance.v1` through Pi's
SessionManager custom entries only for empty non-forked Sessions. Shared Tool
factories for initial/replacement/child runtimes record `shared-unverified` on the
exact SessionManager before invoking existing Experience/SOP Tools. Private Commit
checks all Pi entries for exactly one valid private origin matching this Session,
no parentSession, and no shared Tool history; its asynchronous admission predicate
rechecks the same condition. Branch changes cannot hide restrictive entries.
Forked/legacy sessions are not relabeled private. Pi JSONL remains the only durable
authority, with no parallel database. This migration guard does not assign verified
team/project identity or implement shared history continuation/revocation policy.
OpenViking SyncManager consumes the same `pi67.memory-provenance.v1` record on full
history restore and branch synchronization. If present, exactly one version-1
private origin matching the Pi Session is required; malformed, duplicate, inherited
or restrictive markers trip the existing monotonic scope guard, including when an
OV sync anchor remains valid. Existing external-mode histories without Desktop
records retain OV anchor validation. Pending work is preserved while blocked.
The accepted ADR 0002 replaces the hosted
OpenViking gateway with PostgreSQL content synchronization. Main owns a local
authenticated loopback OpenViking sidecar; Agent Host owns its client, projection
and Tools. OpenViking credentials never enter Renderer or New Money Server.
The sidecar is not a renderer asset server or a business MessagePort replacement.
The OpenViking package now exposes an explicit `createManagedOpenVikingExtension`
Pi ExtensionFactory seam. Its immutable private connection input replaces legacy
transport credentials; it is not inferred from config/environment. Managed outbox
identity uses stable localProfileId plus account/user/workspace peer, excluding
ephemeral port/key and keeping a distinct namespace from external-mode queues.
The connection accepts only loopback and its matching private-profile account.
`SyncManager.restore` treats Pi `message`, `compaction`, `branch_summary` and
`custom_message` entries as existing context history. Without a valid same-session,
same-memory-scope anchor, none may be adopted as a fresh private Session. The
existing blocked-scope guard covers enqueue/replay, automatic capture, remember
and commit; Takeover additionally refuses archive-overview reads and state appends
while blocked. Pi `custom` state entries and model/thinking/label/session metadata
do not by themselves contribute LLM context and do not trigger this history check.
Valid ownership anchors still restore across summarized history. This closes an
unowned-history admission gap, not the separate team/project provenance rollout.
The Extension's shared-Tool guard runs at Pi `tool_call`, before shared content can
return, and monotonically blocks its SyncManager's private writes/replay. It uses
the exact four first-party Experience/SOP Tool identities, not string matching in
message bodies. Restore scans `SessionManager.getEntries()` once, independently of
the active branch's ownership anchor, so compaction/branch navigation cannot hide
recorded shared calls/results. `syncBranch` also checks before extraction. No new
Session truth or private/team relabeling is introduced; the existing history is
retained. A write already dispatched cannot be recalled. Older queued data remains
subject to the pending end-to-end provenance/cutover contract. Runtime outbox replay
now narrows its immutable storage context to the exact anchored OV Session/lineage.
Listing, stale-claim recovery, claim/release, retry/dequeue and TTL cleanup all use
that same Session filter. Other Sessions' files are neither sent nor mutated.
Create payload identity must match the selected Session too. The replay callback
rechecks the captured lineage across awaits, and takeover's pending count is
Session-scoped. The directory/dedup format is unchanged: no queue migration or
deletion is implied. Scope-wide listing remains an inspection API, not replay
authority; the scoped replay wrapper requires an explicit nonempty Session id.
Workbench `context.session.commit` now uses TaskRuntimeRegistry to select exactly
one initialized/open Task for its Workspace and Pi Session. PiSdkRuntime checks
external-file write authority; RuntimeSessionBindings pins its Session object and
generation, requiring idle/no transition. A session-services-local Pi EventBus
selects exactly one owner before invoking it; zero/duplicate owners and concurrent
Commits fail closed. The OpenViking owner rechecks admission/privacy across health
and flush awaits, uses SyncManager's actual OV lineage, and does not queue an
implicit retry on ambiguous failure. Shutdown unregisters and invalidates that
owner, including after resource reload. The direct SyncManager.commit entry permits
only one in-flight Commit across manual and automatic callers; it snapshots the OV target and does not
enqueue a failed Commit against a changed lineage. The bus is an in-process admitted-Extension
seam, not a security boundary against code already executing in Agent Host.
Host no longer submits the Pi id directly to a separate HTTP Commit endpoint.
Only status/archived, allowlisted skip reason, bounded extraction outcome and an
optional external task id return; no bodies or credentials. The managed owner
observes its exact task for at most 30 seconds through its existing scoped client,
checking Session/privacy/lineage before and after reads. Terminal success requires
matching task type/id, Session and archive, without a provider configuration error.
Timeout, stale ownership and malformed/missing receipts remain unconfirmed.
Recall diagnostics additionally record numeric context-request time, other-request
time and request count, scoped to the current uncancelled recall. They contain no
request paths, query/body, response stats or errors. HTTP time includes server and
transport; it must not be described as isolated model/embedding latency.
The managed canonical context request asks for the existing telemetry summary.
Only a successful `search.context` summary's finite, bounded duration and four
allowlisted search-stage durations enter `requestTiming.server`. Raw telemetry,
IDs, token counts, provider/errors and content never enter this diagnostic. Missing
stages remain absent, not zero. Stage timers can overlap/aggregate parallel work;
they are not additive wall-clock phases or proof of total model time. Legacy
requests, model/retrieval options, signed runtime and tracing configuration remain
unchanged; the option only asks the server to include its existing summary.
`context.commitCompleted` ends the Host operation, not necessarily extraction;
its optional fixed `outcome` distinguishes retained/empty/skipped/extracted/
extraction-failed/unconfirmed. Missing outcome is unconfirmed. Renderer subscribes
before submitting and correlates Workspace, Session and operation, with bounded
waiting and stale-Session cleanup; it does not resubmit on timeout or disconnect.
Managed job ids are omitted so legacy external candidate tracking cannot poll a
local sidecar job through another endpoint. Managed candidate tracking remains
pending. Commit acceptance does not assert extraction or publication completion.
Shared Experience and SOP tool factories each own a transient, bounded selection
receipt keyed by Pi Session id. Search clears the previous receipt before access;
only the latest in-flight search may populate it. Read still calls the authorized
Host access path and checks exact id/project/content revision against that receipt
before returning a body. Cancellation, Session changes and intervening searches
reject stale completions. Receipts are not persisted or restored and contain no
body. They neither establish team identity nor replace server authorization,
immutable Session provenance, revocation or private-capture policy.
The Session-bound wrapper additionally captures the active manager object, Session
ID, canonical birth identity and the request model's endpoint/ID. It checks them
before execution, before any Tool update and after settlement. Replacement managers
(even with the same Session ID), identity drift, cancellation or request-model drift
withhold the result and discard that binding's transient selections. A stale
completion cannot clear a newer binding's selection. Fresh search is required after
invalidation; existing Host authorization and Pi Tool leases remain authoritative.
This strengthens the existing Experience/SOP tools, not the pending canonical-body
adapter, and adds no durable Session state or additional model authorization loop.
The managed OpenViking factory is validated through Pi ResourceLoader. The Host now has an explicit
`managedLocalMemory` selection, independent of whether its parent broker exists.
Main's `AgentHostRuntimeEnvironment.managedLocalMemory` now controls the utility
process startup flag `PI67_MANAGED_LOCAL_MEMORY`. Main always overwrites the shell's
value with exact `0` or `1`, including when runtime setup is missing; only an explicit
Main `true` selects managed mode. Host startup parses that flag before constructing
the server and rejects malformed values with a fixed, non-secret error. The flag
contains no installation path, trusted key or model credential. It is immutable
for that Host launch; deployment changes require a controlled restart.
That selection passes a private connection port through TaskRuntimeRegistry,
PiSdkRuntime and session services. Each ResourceLoader gets its own Pi EventBus;
the already admitted OpenViking entry requests its connection on this bus during
initialization, after enabled/owner checks. No second Extension or custom module
loader is added. With managed mode selected, connection failure disables this
memory owner with a sanitized load error; Pi remains usable and no external
credential/endpoint fallback runs. Disabled memory does not request a connection.
The EventBus is an in-process SDK seam among admitted Extensions, not an isolation
boundary against code already executing in the Host. Only the scoped private
connection crosses it; Main root/model credentials and Renderer remain outside it.
On supported macOS arm64, the application now always selects this managed route,
while `LocalMemoryActivationController` independently gates consent. A disabled
preference must not select the legacy external owner path. Generic/standalone
Host compatibility still defaults its route flag off. Loading both owner paths is
not allowed. Selecting the route is not evidence that a service was started.
Workbench inspection uses `local-memory-connect` with `start: false` on that same
private parent channel. Main returns only an already admitted current handle under
current activation consent; it never joins startup, provisions or falls back.
Host coalesces observation separately from startup and retires both on shutdown.
Managed inspection HTTP clients use only the returned scoped identity, forbid
redirects and recheck the live connection before/after requests. Raw transport
errors and private credentials never reach Renderer. App status identifies its
route as `managed:private`; explicit legacy doctor remains a separate action.
Session statistics use `pi67:private-memory:inspect` on the existing owner's Pi
EventBus. Exactly one current owner resolves its OV lineage and performs GET-only
metadata lookup without auto-create, capture flush, commit or model calls. Host
requires one exact open Task/Session; SDK rejects changed generation, provenance or
late ownership, and projects only validated public counts. Unknown counts are not zero.
The internal utility parent channel now owns `local-memory-connect` and its typed
result, bound to a request ID and the current Host instance. The request contains
no caller-selected endpoint, executable, account or model. Main returns only a
loopback connection with a private scoped key, or a bounded unavailable code;
root/model keys must remain with the concrete Main service. This is not a Renderer
command or event. Duplicate requests coalesce, stale Host replies are discarded,
Host shutdown rejects pending requests, and Main stops the service after Host stop.
The concrete `LocalMemoryService` now composes full-tree SHA-256 measurement,
external trusted-key manifest verification, stable identity and native lifecycle.
Each launch (including post-crash recovery) revalidates the installed tree before
identity creation or spawn. Preparation and admission share one tree-hash format.
After OS spawn plus exact Host-ready admission and renderer port handoff, Main
requests a once-per-application warmup through the activation controller. Only
saved enabled launch consent qualifies; unknown/disabled/newly enabled/revoked or
closed controllers do nothing. Warmup joins the existing service single-flight,
never creates a Pi/OV Session or invokes a model; it resolves extraction credentials
only through the now-ready Host. A failed warmup leaves lifecycle failure visible
and does not automatically retry on Host recovery. On-demand connections retain
their existing recovery budget, cancellation and stale-handle checks.
Each actual native launch records configuration, runtime-admission, storage-binding
and native-start durations; native-start also contains process-ready and
scope-provisioning sub-stages. Nested durations must not be summed. Main atomically
retains only the latest receipt in `openviking/startup-diagnostics.json` (0600),
with fixed stage/outcome names and numeric durations, never credentials, paths,
Session identity, error text or memory bodies. Diagnostic write failures emit a
fixed warning without overriding launch/cleanup outcome. Reusing a running service
does not create a fake zero-cost startup sample.
Main can observe the existing supervisor's in-memory lifecycle as idle, starting,
running, failed, blocked, stopping, stopped or stop-failed. Reading this state does
not probe configuration, launch a process, reset the restart budget or expose
credentials/child output. Running means a current admitted native handle, not
proof that a Pi Session has loaded the memory owner or that a model job succeeded.
The narrow Renderer/Main activation bridge additionally exposes an argument-free
`check` operation. Main checks only the current admitted service handle's `/health`,
single-flight with a three-second timeout and redirects forbidden. No credentials,
endpoint, process detail or raw errors cross the bridge; the reply contains the
activation snapshot and `healthy`, `unavailable` or `not-running`. It does not use
`ensureStarted`, and stop aborts the request. Handle invalidation or consent
revocation withholds late success; the bridge rechecks the sender after awaiting.
Periodic lifecycle reads remain network-free. Settings loads the legacy doctor
with `probeRemote: false`; only the separately labeled Advanced manual-address
action probes legacy configuration. Neither probe grants model processing.
Connection delivery rechecks the exact handle after awaiting startup: a crash or
shutdown that invalidated a previously resolved handle rejects delivery. Stopping
remains pending until owned cleanup settles, including a handle whose native parent
already exited but whose descendants/config cleanup is pending. Synchronous handle
cleanup exceptions and rejected cleanup promises stay stop-failed,
never stopped. Shutdown remains terminal for this service instance. This is a
Main-only observation, not a Renderer activation API or permission to hot-switch
the immutable Host mode.
Tree measurement streams at most eight files concurrently, draining before directory
descent or symlink records and folding results in the original sorted depth-first
order. File mode/content/inode-change checks and full-tree coverage are unchanged;
there is no persistent admission cache. Failure/cancellation waits for active file
handles to close, and an abort after metadata read is checked before stream creation.
Before spawn, the service also checks `embedding.json`: a non-secret digest of
embedding protocol, endpoint, model and dimension. Credentials are excluded so
key rotation does not rebuild vectors. A changed binding, corrupt binding or
existing unbound data blocks startup without modifying the old index. Rebuilding
and atomically activating a new index remain pending; no implicit migration occurs.
Admission/startup has a 60-second cancellation budget; Host waits 70 seconds to
allow bounded native cleanup and a reply. Configuration loaders must honor abort.
Main binds the service with fixed paths, platform secure storage and pinned trust,
behind its activation controller. An absent service returns NOT_CONFIGURED; a bound
service with missing settings or failed admission currently returns the sanitized
RUNTIME_UNAVAILABLE code. Neither permits external fallback in the opted-in Pi
consumer. Source integration does not certify packaged application activation.
Main initializes the separate, non-secret `openviking/activation.json` before Host
startup. Missing preferences default off; malformed, oversized, linked or unsafe
files fail closed. The version-1 file contains only `enabled` and is written with
an exclusive 0600 temporary file, fsync and atomic rename under the owned profile.
The narrow Main/Preload activation API accepts only `{ enabled: boolean }` from the
current trusted main frame; its closed snapshot contains no paths or credentials.
Enable checks private runtime presence and saved model settings, then only persists
consent. This app run's launch selection is immutable, including across Host recovery.
Disable immediately fences the same controller held by cached brokers, stops the
service and waits for cleanup and persistence independently. Pending connection
delivery rechecks consent; after stop, re-enable requires a new app launch. Save
failure marks the durable preference unknown rather than claiming it will be off
next time. Cleanup failure remains visible. App shutdown drains pending writes even
if cleanup fails, and still shuts down the installer and broker. None of these
operations migrate/delete data or invoke a model merely to save/read settings.
Renderer polling reads only the in-memory controller snapshot, one request at a
time, with periodic polling paused while hidden. Lifecycle observation is separate
from privacy configuration, current Session ownership and model-job completion.
The Host-side extraction resolver now uses `PiConfigurationService.createModelRuntime`
and Pi `getModel/getAuth` for an explicit Provider/Model selection. It does not
copy `auth.json`, maintain another model catalog or change the Agent's model.
Its secret-bearing result is internal only and has no Renderer command/event.
Current native extraction supports only OpenAI Chat Completions with an API key;
OAuth/subscription delegation, custom Pi execution, extra headers/environment and
other protocols fail explicitly. The private parent channel now accepts
`local-memory-extraction-resolve` with only a bounded Provider/Model selection,
plus request-ID cancellation. The Host broker uses the same configuration service
as its existing settings router, permits one active resolution and returns a
validated model result or bounded UNAVAILABLE/BUSY code. Main correlates the reply
with the exact current ready Host, request ID and selected model. Host exit,
replacement, cancellation or a 20-second reply deadline rejects the request;
Host auth resolution has a 15-second cancellation budget. Shutdown suppresses
late secret-bearing replies. Neither direction uses the Renderer port.
Main now has `LocalMemoryModelSettingsStore`: its dedicated settings directory
follows an explicit Electron `--user-data-dir` when present (`<profile>/openviking`),
otherwise the canonical `appData/New Money/openviking` root. Main selects it before
constructing the service; Renderer cannot select it and no data is auto-migrated.
The settings directory
contains an atomic `models.enc.json` encrypted through `DesktopTextEncryption`.
It stores the extraction Provider/Model selection (never a copied Pi key), plus
explicit embedding protocol/endpoint/model/dimension/key. This is memory job
configuration, not another Pi Agent model catalog. There is no plaintext fallback;
locked encryption, corrupt data and unsafe filesystem targets fail explicitly.
`createLocalMemoryConfigurationLoader` loads those settings, obtains Main-owned
runtime metadata and resolves extraction credentials over the private model client
on each launch. Settings cannot select executable paths or trusted public keys.
Saved changes apply on the next service launch, not by silently changing a running
sidecar; incompatible embedding changes still require a separate index rebuild.
Signed runtime delivery still needs implementation. These components do not enable
managed memory or authorize an external model request by themselves.
The local runtime installer now provides an operator/Main-owned directory-import
transaction, not a Renderer installer or downloader. It admits the fixed private
or explicitly selected team-index-v1/team-query-v1 macOS arm64 target using the source-pinned
verification key, measures the source,
copies into a private staging directory beside the destination, and verifies the
copied tree again. A same-filesystem rename publishes the complete installation.
An exclusive per-version lock serializes cooperating installers; an existing target
is never intentionally replaced. Parent/source must be owned, non-linked directories
without group/other write access and must not overlap. The parent remains trusted
against malicious same-user concurrent filesystem mutation. Cancellation is checked
between copy entries and hashing operations, not guaranteed to interrupt an in-flight
OS file copy. Handled failure cleans only owned staging/lock, not prior versions or
private data. A process crash can retain staging/lock and requires exact-path operator
inspection; no stale-lock auto-recovery or power-loss durability is claimed. Import
does not activate memory, resolve model credentials, or satisfy upstream provenance.
The optional `DesktopSystemBridge.localMemoryRuntime` exposes status and install
with an optional exact purpose (`private`, `team-index-v1`, `team-query-v1`); omitted
arguments retain private behavior. Cancel remains zero-argument. Main validates the
current trusted main frame and rejects unknown purposes, extra arguments and paths.
Only a native directory picker supplies the source; the
destination remains the fixed application/profile layout. A single pending picker
or install across all purposes is allowed; navigation, renderer loss, disposal and shutdown cancel owned
work. Replies contain only bounded status/result literals, never paths or errors.
Status checks do not create directories or claim signature admission. This UI does
not download, activate the service or read a signing private key.
The optional rollout surface `DesktopSystemBridge.localMemoryModels` now exposes
get/save through two narrow Main IPC handlers. Only the current window's main frame
at the Main-selected renderer URL may call them. The TypeBox request is exact and
bounded; replies are checked against a secret-free snapshot schema before returning.
Readback contains extraction selection, embedding parameters and `hasApiKey`, never
the stored key. A save explicitly replaces a key or retains it only for the exact
same protocol/endpoint. First setup or endpoint changes require replacement. The
Main controller snapshots and serializes requests, preserving an earlier save before
a queued retain. Errors crossing IPC are fixed, non-secret messages. No save invokes
a model, starts/restarts the service or bypasses the existing index-binding guard;
changes apply on next start and incompatible indices still need an explicit rebuild.
By explicit user decision, a separate `revealKey({endpoint})` action can now return
the saved embedding API key. It is never included in get/save snapshots. Main binds
the request to the saved endpoint, serializes it with saves, checks the trusted
sender before and after decryption, and returns a fixed error on failure. It never
reads the signing private key or the extraction Provider's credential. The model
form owns revealed text locally (no global store, logging or persistence), discards
display references on hide/blur/document hiding/unmount, and fences late replies.
This is reference cleanup, not a claim of cryptographic erasure from the JS heap.
`createInstalledLocalMemory` now assembles the settings store, private model client,
configuration loader and lifecycle service from explicit Main-owned paths and a
source-pinned Ed25519 public key by default (`openviking-runtime-trust.ts`). Explicit
Main-owned test key injection remains available; bundle/Renderer keys are never
trust authorities. The signing private key is operator-owned outside the repository
and is never read by the application. An installation has `runtime/`, `manifest.json` and a
raw 64-byte `manifest.sig`; the manifest hashes only the runtime tree, not itself.
Metadata reads are bounded and reject symlinks, changed files and POSIX shared-write
installation directories. Writable data/settings must not overlap the installation;
the layout is checked again using canonical paths at load time. Construction does
not download, adopt a development runtime, generate trust or start a process.
After app readiness, `createApplicationLocalMemory` binds macOS arm64 Main to
`app.getPath("appData")/New Money/openviking`, using the existing `DesktopSafeStorage`
and Supervisor's private model client. Runtime selection is the fixed child
`runtime/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64` for private memory;
team preparation uses the separate child with the `-team-index-v1` suffix, and
query preparation uses `-team-query-v1`. Settings and data remain outside all three
children. No Renderer/shell path override, development artifact
scan, existing Session migration, filesystem creation or service start occurs at
construction. Windows and other uncertified native targets remain unbound. Main
passes the lazy service to its existing broker and shutdown path, but leaves the
managed Host flag off until setup/provenance/delivery gates are complete. Binding
is not proof of an installed runtime, model setup, default activation or packaging.
This cutover remains pending; protocol text is not completed-runtime evidence. Local anonymous
Memory stays independent and remains available when New Money is signed out or
unavailable.

依赖方向由 `eng/quality/check-architecture.mjs` 检查，并包含循环依赖检测。

## Workspace identity and atomic file mutations

Workspace 移除在 Host 注销确认后失效该 Workspace 的注册缓存。Main 移除失败时重新读取其 Registry：
注册仍在则恢复 Host 注册；已移除则同步清理 Renderer 注册；读取失败保留可见状态而不猜测 Host 补偿。
原移除错误继续对调用方可见，补偿失败必须同时报告，不能伪装成功。移除弹窗按当前 Renderer
登记区分仍显示的失败与已移除后的清理/确认失败；后者关闭失效的移除弹窗。
Main 仅在 Registry 移除成功后清理附属状态；按顺序尝试全部清理项，单项失败不阻断其余项，
包括 Catalog 在内的清理错误汇总返回。重复请求仍执行清理；这不构成持久重试队列或自动恢复保证。
草稿和文件状态清理仅在完整状态可读取且结果已持久化时成功；所需加密/解密不可用导致状态
不完整或无法持久化时必须报错，并保留原磁盘数据，不得把内存移除视作持久清理完成。
解密失败后须重新加载完整状态再清理。

Electron Main 的 Workspace Registry 保存稳定 `workspaceId`、native canonical path、lossless
`dev` / `ino` / `birthtimeNs` 物理身份（可用时）和最近一次成功验证时间。同一挂载周期内的重复目录判定
继续严格比较三项物理字段；跨启动恢复则区分持久文件身份和挂载期设备编号：macOS/APFS 在重启或重挂载后
可能只改变 `dev`，因此仅当 native canonical path、`ino` 和 `birthtimeNs` 仍全部精确匹配时，Main 才更新
`dev` 并恢复原 trust。旧版严格比较已经生成的 bounded `identity-changed + unknown` 误报也只在这组精确条件
下恢复。路径、`ino` 或 `birthtimeNs` 任一变化仍标记 identity changed 并撤销继承 trust；路径缺失按
offline 状态保留注册但禁止 Host admission。只有 path-only 证据时，即使 canonical path 字符串相同也进入
`needs-confirmation`，必须经 native picker 明确修复。用户通过 picker 选择移动后的同一目录或明确选择替代
目录属于显式 rebind；Main 不扫描无关用户目录猜测 relocation。

Pi Provider/configuration、Context Markdown 和 Agent Host Workspace file save 使用同一
`safeAtomicReplaceFile`：在目标同目录以 `wx` 创建临时文件、写入并执行 file fsync，在调用方最后一次
opaque revision 校验后 atomic rename，再 best-effort sync parent directory。Windows rename 仅对
`EACCES` / `EPERM` / `EBUSY` 使用 25/50/100/200/400 ms 有界退避；`EEXIST`、revision conflict、
path escape、invalid payload 和其他错误不重试。Pi 配置仍在 path-scoped lock 内校验 aggregate revision；
Context/Provider validation 或 Runtime reload 失败时，只有当前文件仍等于本次写入版本才允许回滚，外部
再次修改会保留冲突而不是覆盖。该合同不把多个独立用户操作伪装成不存在的多文件事务。

Provider 配置投影在每次 refresh 内只读取一次 models/auth/global-settings 三个全局文件，
并为该轮各 Workspace 复用同一份读取结果；项目配置仍独立按 trust 读取，未受信任项目只取
原有文件元数据、不读取内容。该批次不跨 refresh 或 mutation 缓存，不构成多文件原子快照；
下一次读取仍检查当前文件，原有 revision、错误、超时与 Runtime reload 规则保持不变。

Custom Provider 模型发现使用 App-scoped `provider.modelDiscovery.inspect`，不复用
`provider.modelCatalog.refresh`：后者只刷新 Pi Runtime 已注册且实现 `refreshModels` 的动态
Provider。Renderer 只提交 Provider ID、Base URL、默认选中的 OpenAI/Anthropic/Gemini 协议族、
OpenAI 导入 API 选择、默认开启的 aggregate Bearer 认证标志，以及可选的一次性 API Key。
Agent Host/Pi Runtime 的默认路径只对同一 `/models` 目录执行一次有界 Bearer GET，再把规范目录
按所选协议族分类；显式关闭 `authHeader` 时才按 OpenAI Bearer、Anthropic `x-api-key`、Gemini
`x-goog-api-key` 的认证语义执行有界并行 GET。两条路径都禁止跨 origin redirect，最多读取
2 MiB 并最多投影 512 个模型；response body、credential 和网络错误对象均不返回 Renderer 或日志。
`provider.modelDiscovery.cancel` 只取消当前内存请求，不产生持久 mutation 或 replay ledger。

发现结果按模型的真实请求 ID 合并，输出协议族、精确 Pi API、可选 supplier、catalog-only
证据、各协议结果和 bounded collision。新模型由 Renderer 明确加入草稿后，仍通过已有
revision-fenced `provider.configuration.save` 写 `models.json`；可选新凭据随后通过独立
`provider.credential.store` 写 `auth.json`。后一步失败时前一步保持为可见的未认证 Provider，
不能伪装成多文件原子成功。已有模型、未知自定义 API 和 write-only Header 不因发现被覆盖。

## Desktop-owned extension build boundary

Capability preparation compiles only the locked first-party rules loader and OpenViking
entry into ESM `index.js`, declared explicitly in their prepared Pi package manifests.
The locked source tree and its provenance stay unchanged. OpenViking bundles its exact
TypeBox dependency and retains its MIT license; generated entries have only Node built-in
runtime imports. Generated JS, manifests and license bytes participate in the existing
prepared tree hashes. A catalog revision invalidates older prepared capability output.
Pi ResourceLoader remains the sole extension loader; user and third-party extensions
retain Pi's supported loading path. Desktop's Session-only settings exclude both `.ts`
and `.js` shared projections of these owned entries, preserving one canonical owner
without modifying user settings or resources.

## Startup and recovery

1. Main 注册 secure `app` scheme 并创建窗口；Welcome 不启动 Agent Host。
2. 用户选定 workspace 或运行依赖 Agent Host 的恢复与诊断后，renderer 通过窄 IPC 请求按需启动。
3. Agent Host 启动协调器先按 Agent 目录和有效 Desktop capability receipt 分类
   `fresh | existing-shared | desktop-managed-upgrade`，再依次处理 Desktop capabilities、managed Packages、
   retired MCP cleanup、browser67 MCP 和核心 Server construction。它不检查系统 `pi` 命令，也不创建第二套
   Profile。`existing-shared` 的无 receipt 资源全部视为用户拥有；Desktop 只写
   `desktop-capabilities/**`、`rules/pi67-desktop/**` 和带有效 receipt 的精确 MCP 条目。首次在 shared
   Profile 写入 capability state 时会持久化 `profileOwnership=shared`，后续升级仍保持 shared 分类。
   Alpha.21 等旧 state 没有该 ownership 字段，同样按 shared 迁移，不能由旧 capability 安装事实推断整个
   Profile 归 Desktop 所有。
4. `fresh` packaged Profile 的 capability manifest/hash/private toolchain 错误属于确定性 fatal；
   existing/shared 或 managed-upgrade Profile 的用户资源冲突、MCP cache/CAS conflict 和 Desktop-owned
   enhancement I/O failure 只形成最多八条安全 startup issue。核心 Server 构造成功后 Host 发送严格的
   `agent-host-ready { startup }`，状态可为 `ready` 或 `degraded`；消息不含 path、raw error 或 stack。
5. Agent Host `spawn` 且 Main 收到有效 ready 后才转移新的 MessagePort；窗口 reload 的 `did-finish-load` 以及 renderer
   的显式恢复请求都会为仍存活的同一 Host broker 新 Port，而不会 fork 第二个 Host。若 Host 正处于
   supervised restart backoff，恢复请求不能绕过退避计时器。
6. Preload 只在可信 renderer origin 上转交 MessagePort；renderer 的
   `AgentConnectionController` 独占 Client 生命周期；feature controller 发出 typed request，Store 只消费
   typed event 与 teardown，组件不持有底层 Port。Controller 只接受当前 window source 与精确 origin 的 handoff；
   Port `close`、`messageerror`、Host generation replacement 或 Controller dispose 会立即释放旧 Client、
   拒绝 pending request 并阻止旧响应重新进入 Store。Controller dispose 同时移除全局 message listener，
   后续 handoff 和公开请求均 fail closed。
7. 用户选定 workspace 后发送 `workspace.open`；Host 以同一
   `runtime.initialize(payload)` 生命周期加载 Pi SDK，并通过 `runtime.ready` 投影权威
   `sessionGeneration`。`session.create` 只在当前 workspace 创建新 Session，不接受伪 cwd。
8. 未发送结构化 startup failure 的未知 crash 在 60 秒内最多自动重启三次，退避为 0.5/1/2 秒。
   预算耗尽后普通 connect/Port renewal 保持停止，只有显式 Main-owned restart 清除停止状态并重置预算。
   `agent-host-startup-failed` 是确定性失败：Main 记录安全 stage/issue、向当前 Renderer document 只发送
   一次失败并停止自动重启。显式 Main-owned restart 可开始新 Host epoch。
9. 新端口携带 `appInstanceId` 与 `hostEpoch`。Renderer 的连接请求是有界 single-flight：Port-only
   断线会自动请求 renewal，重复调用不会并行建立多条恢复链。若 Main 已交接一个开放 Port 但 welcome
   握手尚未完成，后续调用先等待该 Port，不能再次请求交接并关闭握手中的 Client。同 epoch 重连通过
   `projection.resync` 恢复 Snapshot、Recorded Changes、Catalog status、session generation 和 active
   Operation；若 Operation 在断线窗口内结束，resync 还可返回最近的 typed terminal receipt。Renderer
   只在 receipt 的 Operation ID 与断线前 active Operation 相同时恢复它，不采用无关历史。
   同一恢复 incident 内重复 Port 中断保留首次在途 Operation 身份，直到恢复收敛或 Host replacement；
   已清空的瞬态 AppState 不得覆盖该身份。只有
   `hostEpoch` 变化才用当前 workspace、trust、approval mode 与 session path 重新初始化。

打包环境无条件忽略 `PI67_RENDERER_DEV_URL`，只加载 `app://pi67/index.html`；开发环境只接受
精确的 `http://127.0.0.1:5173`。生产协议解析只接受 exact `app://pi67` authority，拒绝 credentials、
port、query、fragment、malformed/repeated percent encoding、encoded separator、control byte、dot segment、
drive/UNC/ADS 形式，并在单次解码后验证 resolved Renderer root containment。导航、redirect 和 Port attach
都重新验证当前 document。
恢复不是成功声明：same-host renewal 必须完成握手和权威 resync，Host replacement 必须完成握手、
`runtime.initialize`、`runtime.ready` 携带的新 `SessionSnapshot` 和对应窄 acknowledgement，之后 UI
才能离开 recovering。

## Application shutdown

`before-quit` 由 Desktop Main 的单一 shutdown controller 持有。第一次 quit 会阻止 Electron
继续退出，立即把 Supervisor 置为 stopping，并执行以下有界链路：

1. 清除 Host restart、poisoned-runtime replacement 和 Port renewal；新的 connect、attach 与窗口创建全部拒绝。
2. Main 发送严格校验的 `agent-host-shutdown` parent message，只携带 reason 和 100-10000ms deadline。
3. Agent Host 关闭 Scheduler 与 managed-resource admission，使未开始的 exclusive/recovery/Queue/Package
   work 失效；新的请求返回 `CONNECTION_CLOSED`，不能在关闭过程中静默执行。Host-owned Package Worker
   supervisor 同时拒绝新操作，对所有 active worker 执行 graceful tree termination，再在有界 grace 后执行
   forced tree termination，并等待 root exit。POSIX worker 以 detached process group 启动；Windows 使用
   `taskkill /PID <pid> /T` 与 `/F` 的两阶段 tree cleanup。只有观察到退出才算该 worker 已清理。
4. Runtime 以 `runtime-dispose` 取消 Extension/Approval 请求；Operation Registry 使用关闭专用语义尝试
   abort active Operation。成功产生一次 `operation.cancelled`，不可取消、abort failure 或 abort timeout 产生
   一次 `operation.lost`，但不触发 poisoned-runtime restart。
5. Runtime dispose 保留 Pi `session_shutdown(reason="quit")` 与 JSONL 所有权；Desktop 不自行写 Session 文件。
6. Host 关闭 MessagePort，返回只含 bounded count 和 Operation 终态的
   `agent-host-shutdown-complete`，随后退出 utility process。Main 只有在收到 completion 且观察到 exit code 0
   后才标记 graceful；deadline 到期则 kill 并继续退出。

Supervisor `stop()` 是 idempotent Promise。graceful 路径等待 Host 实际退出；forced 路径有固定上限，且两条
路径都保持 stopping fence，不能因 late exit、late parent message、`activate` 或 `did-finish-load` 复活 Host。
Shutdown metadata 不包含 Prompt、Session path、命令、source、raw Tool payload 或错误堆栈。

## Skill Pack process completion

POSIX Skill Pack runner 默认按有限任务处理：root 自然成功/失败、取消和超时均经过所属
process group 的有界回收；确认组内无存活进程并等待 stdout/stderr close 后才返回。
清理失败优先于命令结果，管道关闭超时返回失败并释放本地管道；不承诺回收主动脱离组的进程。
仅 Lark `auth login --no-wait` 与 `config init --new` 显式设置内部
`preserveAuthorizationDescendants`，保留自然 root-exit 返回以免关闭授权 UI；取消和超时
仍回收所属组。该选项不跨 IPC，不改变 Windows Job Object 的既有完成规则。

## Package operation isolation

Extension Package 的 check/install/update/uninstall 不在长期存活的 Pi Runtime 对象中执行。Agent Host
为每个操作启动一个 Electron-as-Node worker，但由同一个 Host-owned supervisor 持有全部 child record；
Workspace 间不会各自创建无法统一关闭的 worker owner。每个 request 使用独立 correlation ID、最长 1 MiB
的 JSON IPC response、最多 512 个结果项和字段级长度校验。oversize 或 malformed correlated response
立即 fail closed，不能等待超时后猜测成功。

Package worker 不继承 Agent Host 的完整环境。只允许私有 Node/npm/Git 路径、Package network settings
locator、PATH、临时目录、home/profile locator、Windows system process variables 和 locale；Provider key、
MCP bearer token、OAuth/Cookie、任意 npm auth 环境变量和 Session/Workspace secret 不传入。stdout/stderr
均丢弃且不进入日志。Package worker 仅隔离 Package mutation；它不证明已安装第三方 Extension 的
module import、factory、hook、Tool 或 MCP child 已隔离。

Package mutation 的业务提交点位于 worker 返回之后。Host 先 reload 自己持有的 Pi Settings，再由
`PackageTrustRegistry` 对当前安装目录做 bounded observation，最后把 redacted receipt 持久化到
`<storageRoot>/package-mutation-receipts-v1/<owner digest>.json`。receipt 使用 `0700` 目录、`0600`
文件、进程内串行化、跨进程 lock、2 MiB/512-record 上限和 `SafeAtomicIo` replace。它只保存 source、
idempotency key、fingerprint、owner 的 SHA-256 digest，以及 bounded package name/version、manifest hash、
content hash、directory identity digest 和时间戳；不保存 raw source、Git URL、安装路径、Workspace 路径、
凭据、Prompt、源码正文、stdout/stderr 或文件列表。

状态为 `reserved -> mutating -> active|removed|ambiguous`。`active` 需要 Main-Host Settings reload、当前
observation 与 durable commit 全部成功；`removed` 需要目标 `(source, scope)` 在 reload 后确实不存在。
Host replacement 遇到 terminal receipt 只重验当前 trust projection；`reserved`、`mutating`、`ambiguous`
或 active receipt 对应的当前 drift 都返回 `ambiguous`，绝不再次调用 worker。Pi SDK 的 update 可能同时
改变 global/project 同一 package identity，Host 会刷新另一 scope 已有 active receipt 的 observation。
receipt commit 后的 Task `reloadResources()` 仍是独立阶段：失败会返回错误，但不撤销已证明的 Package
提交，也不盲目重放副作用。

`PackageTrustRegistry` 只把 `builtin-verified` 与 `user-installed-observed` 暴露给 Session 专用 Settings
view，因此缺失、无 receipt、mutation ambiguous、identity/hash drift 或 inspection limited 的 configured
Package 不会被 Pi ResourceLoader 隐式安装或加载。第三方 bounded content hash 排除 `.git` 与
`node_modules`，限制 10,000 files、128 MiB、depth 32 和五秒；它不是 registry integrity、签名、provenance、
完整依赖树证明或不可变文件系统 snapshot。

当前 Pi SDK 0.86.1 没有 Extension executor、module-loader transport、Hook/Tool RPC 或 MCP supervisor
injection point。`DefaultResourceLoader -> jiti.import -> factory(pi) -> ExtensionRunner` 仍在 Agent Host
utility process 内运行。Package worker 也不拥有第三方 Extension 自行启动的 MCP child。真正的 runtime
isolation 需要上游 executor/proxy port、经审计的 loader/runner fork，或明确禁用 unsupported third-party
execution；仓库不创建无真实调用方的 Extension Worker 空壳。

Team MCP bootstrap 对 `<agentDir>/mcp.json` 使用 `SafeAtomicIo`：保留首次读取的 exact bytes 或 missing
revision，写同目录私有临时文件并 flush，在 rename 前重新读取。revision 不一致返回
`revision-conflict`，保留外部版本并清理临时文件；invalid JSON 仍保持原文件不变。文件只保存
`bearerTokenEnv`，不会保存 bearer token。

## Protocol

所有 envelope 使用 `protocolVersion: 4`：

- hello/welcome：协商 `appInstanceId`、`hostInstanceId`、`hostEpoch`、初始 event sequence、
  capability、`idempotentControlMutations` 和 envelope byte budget；
- request：`requestId`、`hostEpoch`、typed command/payload；replay-safe control mutation 还必须携带
  caller-stable `idempotencyKey`；
- request-cancel：只携带同一 MessagePort 上已有的 `requestId + hostEpoch`，用于释放单个 caller，
  不关闭共享 Port，也不授予新的 command authority；
- response：复用 `requestId` 和 command type，返回 typed result 或 redacted structured error；
- event：单调递增 sequence，并按需携带 `sessionId`、`sessionFileIdentity`、
  `sessionGeneration` 与 `operationId`。

Agent Host 对不可信 renderer 消息先执行 TypeBox envelope validation。命令 payload 的
业务边界由 command handler 和 Pi SDK 再校验。可安全关联的无效请求立即返回
`INVALID_PAYLOAD`；Host epoch 不匹配时 fail closed。Prompt 输入图片仅允许 PNG、JPEG、WebP 和
GIF，最多 8 张、单张最多 10 MiB、总计最多 30 MiB；每个 `data` 必须是当前 Agent Host realm
的 `ArrayBuffer`，并通过 transfer list 移交以避免复制。Session 输出图片使用独立的
`AssetReference` / `asset.read` 合同，不复用 Prompt 输入数组。

消息页、快照及重同步的消息联合包含 `vision-evidence`。其 Provider/Model、图片附件元数据、
非空描述和非负有限 usage/cost 与 Pi 视觉辅助记录投影一致，并保持严格字段和数量/长度边界。
合法的持久化视觉辅助记录不得使 Renderer 的 Port 校验失败。

Renderer 对 Host event 不只校验 type-specific payload schema，还按完整事件清单校验 context：Session-scoped
事件必须同时携带 `sessionId + sessionFileIdentity + sessionGeneration`，Operation/Turn/Approval
事件还必须携带
`operationId`；bootstrap snapshot、Operation view、Workspace Change、Approval 和 Extension UI payload
中的 authority 必须与 envelope 一致。新增事件类型若未声明 context requirement 会在 TypeScript 编译期失败。
当前 Host 发来的 event-shaped 非法帧会立即以 `INVALID_PAYLOAD` teardown Port 并拒绝所有 pending request，
不能静默忽略并等待下一条 event 才通过 sequence gap 间接发现。

每个 MessagePort 的 `hello` 握手是 single-flight。Host 在异步加载 SDK version 和 event sequence
期间只接受第一条通过 app instance 与 envelope 校验的 `hello`；重复帧不会再次执行 welcome work、
不会产生第二个 `welcome`，也不会扩大 Runtime loader 并发。握手完成后的重复 `hello` 不会重新协商
当前 Port；Port replacement 必须建立新连接并重新执行一次完整握手。

`prompt.submit`、`command.invoke`、`session.compact` 和 `session.import` 使用 accepted Operation 合同，
并由 caller-stable `submissionId` 与 SHA-256 payload fingerprint 去重：同一 submission 重试返回同一
Operation，同一 ID 携带不同内容则拒绝。Prompt fingerprint 覆盖 delivery、text 与图片元数据/bytes；
其他三类文本 Operation 使用 `command type + NUL + canonical text field`。Host receipt 只保存 fingerprint，
不保存 import path、compaction instructions、Extension command 或 Prompt 原文。Host 的 accepted/running/
settled submission record 同时绑定创建时的 Session ID、opaque physical identity 和 generation；
当前 Runtime 的物理 Session identity 改变后，同一 `submissionId` 不能重放旧 accepted Operation，
而是返回 `STALE_SESSION_IDENTITY`；只有 generation 单独推进时返回
`STALE_SESSION_GENERATION`。Renderer 在发出 Prompt 前捕获 Host epoch、Session ID、opaque physical
identity、generation 和本地 projection revision，并在清空 Composer 前同时校验 accepted response 与当前
Session authority；
Host 替换、Session 切换或同 Session projection transaction 已推进时，迟到确认都会被忽略，草稿和附件保留。
Host 必须在 accepted receipt 持久化成功后才返回 accepted response，并在 running receipt 持久化后异步发送
`operation.started` 和调用 Pi；完成、失败、取消和 Host 丢失是互斥 terminal state，terminal receipt 必须
先提交再发布对应 event。Session transition
串行执行，Turn 互斥，steer/follow-up 只在 active Operation 可接收队列时进入独立的严格 FIFO Queue
Lane。Queue Lane 默认最多 admission 32 条正在执行或等待执行的 delivery，容量耗尽返回可恢复的
`RESOURCE_LIMIT_EXCEEDED`，不创建无界 Promise 链。abort、`queue.clear` 和 extension response 仍通过
interrupt 路径绕过普通队列。Query lane 可受控并行，control mutation 与 active Turn 不会竞争。

Workspace-scoped `session.creation.resolve` 不经过 Task Scheduler，而由 Agent Host 的独立 query
coordinator 管理。同一 `workspaceId + creationId` 共享一次 single-flight 扫描；Host 最多并行 4 个、
每个 Workspace 最多并行 1 个 resolution，最多保留 64 个 distinct job 和 256 个 waiter。超过边界返回
`RESOURCE_LIMIT_EXCEEDED`。单个 Renderer Port 最多保留 256 个 pending request；Port retire/close 会取消
该连接的 waiter，只有最后一个 waiter 离开或 Host shutdown 才取消共享扫描。JSONL fallback scan 还受
10,000 个文件、64 MiB 总读取量和 10 秒总时间预算约束，预算耗尽返回 `unavailable: scan-limit`，不能
退化成无界目录/文件读取或伪装成 storage error。exact marker 与 matching header/canonical path 是
创建事实；Renderer 不再等待 SQLite Catalog 二次确认。Catalog upsert 在 authoritative bootstrap 之后
异步执行，失败只触发 metadata refresh/rebuild，不能把已创建结果改写为 `REQUEST_OUTCOME_UNKNOWN`。

Workspace-scoped `workspace.usage.report` 同样不创建 Task 或加载 Pi Task Runtime。Agent Host 按
`workspaceId + window` single-flight，同一 Workspace 最多运行一个冷扫描、全 Host 最多并行四个扫描，
最多保留 32 个 job 和 128 个 waiter；新窗口替换旧窗口，最后一个 waiter 取消、Renderer 单请求取消、
Port 关闭或 Host shutdown 都会向 JSONL scanner 传播 `AbortSignal`。扫描仍受 500 个 Session、128 MiB
总读取量和五秒 deadline 约束。Renderer 在窗口、Workspace、连接状态或 Host epoch 变化时撤销旧请求，
同 Host 重连也必须重新构建，不得保留旧报告或永久 loading。

Pi Runtime 在 `session-creation-journal-v1` 中维护私有 Durable Creation Journal，并通过 per-creation
跨进程文件锁串行化状态推进。事务顺序是 `reserved -> materializing -> materialized -> published`：
`reserved` 在任何 Pi 创建副作用前持久化，并必须先完成上述有界 exact-marker 扫描；只有明确 `missing`
才写入 `materializing` 并调用 Pi。marker 持久化且 Session ID、path 与物理 JSONL identity 一致后写入
`materialized`；权威 Snapshot/bootstrap 构建完成后写入 `published`，Catalog upsert 不在提交关键路径。
进程在 `materializing` 后死亡时，唯一 exact marker 可恢复 `materialized`；没有 marker 或存在多个 marker
则写入 `ambiguous`，后续创建请求返回 `REQUEST_OUTCOME_UNKNOWN`，绝不再次调用 `newSession()`。Journal
丢失或旧 `session-creation-receipts-v1` 存在时，只能经 exact marker 验证后重建/迁移。entry 仅保存
creation/workspace key、状态、Session ID/path、物理文件 identity 与时间戳，不保存 Prompt、Assistant、
Thinking、Tool 参数、源码、附件或凭据。Protocol v4 尚无 Renderer-to-Journal ACK，因此生产路径当前止于
`published`；`acknowledged` 仅保留为后续显式协议状态，不能作为当前完成声明。

Session writer lease 使用两层 authority：Agent Host 内 Map 负责同进程 Task transition，Main-owned
`PI67_STORAGE_ROOT/session-writer-leases-v1` 下的 `proper-lockfile` 锁负责 Host replacement 的跨进程窗口。
每组 identity 去重、稳定排序后依次 acquire，失败按逆序 release，避免多 key 获取次序漂移。未物化 JSONL
先持有物理 parent + 精确 leaf；commit 在该 provisional fence 仍存活时重新 canonicalize Runtime 最终路径，
取得 `device + inode + birthtime` 物理 key 和 canonical leaf key 后才完成 rekey。replacement transition 会同时
保留 old active 与 new pending lease：cancel 只释放 new，commit 才在新 physical fence 成功后释放 old。

跨进程 lock directory 的 mtime heartbeat 是 stale 判定依据，PID 只作诊断，不能单独授权抢锁。默认 stale
阈值为 30 秒、lock heartbeat 为 10 秒；明确 stale 才允许 `proper-lockfile` 原子恢复。每个 identity 的私有
metadata 只记录 version/token、app/Host instance、Host epoch、PID、acquired/heartbeat time 以及 Task/Session
identity hash，不记录 Workspace/Session path、Prompt、源码或凭据。metadata 可在崩溃中损坏且不参与所有权
判断；真实 fence 是原子 lock directory。heartbeat compromised 会发送严格无 payload 的
`SESSION_WRITER_LEASE_COMPROMISED` supervisor message 并触发 Host replacement。Task close、replacement 和
Host shutdown 只在 Pi Runtime dispose 成功后异步 release；dispose 无法证明完成时保持 lease 到进程退出，
绝不提前授权新 writer。

Agent Host 为每个 Task generation 在 `PI67_STORAGE_ROOT/operation-receipts-v1` 维护最多 512 条
insertion-ordered durable receipt。目录和文件在 POSIX 上分别收紧为 `0700` / `0600`；写入使用
`proper-lockfile`、同目录临时文件、file fsync、atomic rename 和 directory fsync，Windows 只对
`EACCES` / `EPERM` / `EBUSY` 做有界退避。symlink、hard-link、超限、损坏或不可写 ledger 返回带
`operationReceiptIntegrity` 的 `RUNTIME_POISONED`，且不会调用 Pi。容量只淘汰 settled receipt；若 512 条
全部未确认则返回 `RESOURCE_LIMIT_EXCEEDED`。

Operation 进入 completed、failed、cancelled 或 lost 后，指向该 Operation 的主 submission 与 queued
steer/follow-up submission 会在一个 locked atomic commit 中统一更新为同一 typed `OperationSettled`。
Session import 的 terminal receipt 可绑定导入后实际生效的 Session ID、opaque physical identity 和 generation。
receipt 只保存 lifecycle、时间、Host/Task/Session authority 和脱敏结构化错误；不保存 Prompt、import path、
command、compaction instructions、source、attachments、credentials 或 raw tool payload。

replacement Host 在 `projection.resync` 或下一次副作用接纳前读取同一 Task ledger：settled receipt 以当前
Host epoch 恢复；accepted/running receipt 原子提交为同一 Operation ID 的 `lost`，reason 明确表示旧 Host
终态未确认且没有重放。旧 Host 的迟到 completed/failed 只能读取并发布已经存在的 canonical `lost`，不能覆盖。
Renderer 对 `session.import`、`session.compact` 和 `command.invoke` 的 accepted ACK 仍只允许同 Host epoch
的一次有界 transport retry；新 Host 只做 receipt reconciliation，从不自动发送原业务 payload。
`prompt.submit` 不进入这条自动 retry 分类：图片通过 transferable `ArrayBuffer` 移交，第一次发送后
buffer 已 detached；Composer 保留草稿和附件，由用户在当前 authority 下显式重试。

Renderer 还将一次 `session.import` 绑定到提交前捕获的 Host epoch、Session identity/generation 和
projection revision。只有匹配的 accepted ACK 可以进入运行态；导入后的匹配 `session.bootstrap`
才有权安装新 Session 并解除 transition。Bootstrap 之后到达的旧 terminal response 或 rejection
不得覆盖新 Runtime/Operation，也不得清除下一次 transition。若同 Host replay 返回 completed receipt
但 Renderer 没有观察到对应 bootstrap，或 imported-Session terminal event 先于可接受的 Bootstrap
抵达，Renderer 启动 100ms、按 Host epoch + Operation ID 去重的一次性 Bootstrap watchdog。宽限期内
到达的匹配 Bootstrap 会取消 watchdog；到期后只执行一次 `projection.resync`，不把旧 projection 标记
为 ready，也不重复 import。resync 失败才进入明确的 recoverable failure。若导入已经切换 Pi Runtime
后才失败，Host 先发布当前 Session bootstrap，再发布 failed terminal，使 Renderer 与 Pi 的实际 writer
authority 保持一致。

同步 control mutation（runtime/workspace initialize、Session create/open/fork/rollback/name、
model/runtime key/thinking 和 resource reload）使用独立的 replay-safe 合同。Renderer 为一次逻辑
mutation 生成一个稳定 key，遇到 ACK timeout、Port close 或本地 connection generation 替换时最多
重试一次，并在第二次 request 中复用同一个 key。Host 的内存账本按 Host epoch、command、canonical
payload SHA-256、Session identity/generation 和 mutation revision 校验；同 key 同 payload 共享 pending
Promise 或返回已完成结果，同 key 不同 payload 返回 `DUPLICATE_REQUEST`，Session authority 已变化则
返回 `STALE_SESSION_GENERATION`。账本不保存原始 payload，不写磁盘，默认最多 16 条、8 条 pending、
settled result 保留 5 分钟；容量耗尽 fail closed 为 `RESOURCE_LIMIT_EXCEEDED`。Provider runtime key
只参与瞬时哈希，不进入 ledger、日志或 renderer state。

`session.rollback` 是增量投影 control mutation，不返回 `SessionSnapshot`。Pi Runtime 先发出
`conversation.changed`、`tree.changed` 和 `usage.changed`，Host 再返回仅含 Host/Session authority
与已发布 `eventSequence` 的窄 acknowledgement。MessagePort 顺序保证 ACK 不会越过这些事件；Renderer
只验证 acknowledgement，不用 command response 重装 Conversation、Tree、Queue、Resources 或 Usage，
从而避免宽 Snapshot 覆盖已经开始的增量刷新，也避免为一次 rollback 重建和 structured-clone 全会话。
`session.name` 使用同一投影变更合同：Runtime 先持久化名称、更新 disposable Catalog 并发布
`session.metaChanged`，Host 再返回窄 acknowledgement；重命名不再重建或传输 Conversation、Tree、Queue、
Resources、Model Catalog 和 Usage。

`runtime.initialize`、`workspace.open`、`session.create`、`session.open` 和 `session.fork` 的完整投影只由
`runtime.ready` / `session.bootstrap` 事件发布。Host 必须先发送该权威事件，再捕获当前 Host epoch、
Session ID/generation 和已发布 `eventSequence`，最后返回 `ProjectionMutationAcknowledgement`。Command
response 不再重复携带 `messages`、Tree、Queue、Resources 或 Usage，因此同一 lifecycle Snapshot 不会被
Structured Clone 两次。Renderer 只允许 bootstrap 事件安装 Session；ACK 到达时若 bootstrap 尚未提交则
fail closed，若旧 Host 或更晚的 Session transaction 已经取代请求则丢弃迟到 ACK。协议不再暴露含糊的
`session.branch(newFile)`：Pi `fork()` 创建新 JSONL Session，对应 `session.fork` + bootstrap ACK；同文件
Tree 导航继续使用 `session.rollback` + incremental ACK，二者不会共享宽 Snapshot response 或布尔分支语义。

`projection.resync` 使用独立 recovery lane：它可以捕获 active Turn，但若 control transition 已经
admit，则排在该 transition 后读取一致投影；后续 control mutation 又排在 resync 之后。这样 Port
renewal 不会因 `runtime.initialize` 或 Session transition 的 `BUSY` 假失败，也不会在 transition
中途拼接两个 session generation。由于当前 resync projection 不携带 pending interactive request，
Host 会先以 `projection-resync` 显式取消 Approval 和 blocking Extension wait，再捕获 event sequence
与 active Operation；Renderer 因此不会清空 Dialog 后让 Pi Bridge 无界等待。未来若引入 bounded
pending-interactive projection，必须替换该 fail-closed 路径，不能同时维护两套恢复语义。

`OperationAccepted` 和 `OperationView` 的 `cancellable` 由 Host 是否为该 Operation 注册真实 abort
回调决定，而不是由 Renderer 按 kind 猜测。Prompt 和 compact 绑定 Pi `session.abort()`；Pi SDK 的
Extension command handler 不属于 Agent streaming abort signal，因此 `command.invoke` 与 Session import
当前都明确为 `cancellable=false`。应用关闭仍通过 Pi `session_shutdown(reason="quit")` 和 bounded Host
deadline 收口；Host 对不可取消 Operation 的 `operation.abort` 返回 `aborted=false`，Renderer 不显示虚假的
停止按钮。

排队 steer/follow-up 使用独立的 Operation 队列取消信号。用户取消、forced-loss 或失败终态立即
取消队列执行等待；底层附件读取或视觉辅助即使不响应取消，也不能阻塞终态和 replacement 通知。
Pi Runtime 在 writable/configuration、附件和视觉准备之后，以及后续 Session 写入与入队之前复核信号；
迟到 resolve/reject 仍被观察，但不得继续交付。正常完成仍等待已接受队列完成；abort 失败恢复主任务时，
新队列使用新的取消信号，不复活已取消的旧队列。终态仍必须持久化一次后才发布。

可取消 Operation 的 Pi abort 受 10 秒 watchdog 约束。watchdog 到期不代表底层工作已经停止，因此
Host 绝不清除保护后继续接收新 Turn：Operation 先进入 `operation.lost`，stream buffer 只 flush 一次，
Registry 标记为 poisoned，并以 `RUNTIME_POISONED` 结束 abort request。Host 随后发送 recovering status，
通过严格、无 raw payload 的 `agent-host-runtime-poisoned` parent message 请求 Main Supervisor 替换 utility
process；Main 给 MessagePort 50ms terminal-event 投递窗口后 kill，Agent Host 自身另有 250ms forced-exit
fallback。替换继续使用既有 restart backoff 并产生新的 Host epoch。旧 Runtime 无论 abort Promise 之后
resolve、reject 或原 Turn 结束，都不能再发送 completed/cancelled terminal event，也不能恢复 admission。

Session import 的 post-switch recovery 使用同一 poisoned-runtime replacement 边界：如果 Runtime identity
已切换到 managed copy，但 `getSnapshot()` 或 Bootstrap 发布失败，Host 不能继续以不可投影的 writer
authority 服务请求。Registry 将 import 标记为 `operation.lost` 和 poisoned，并发送严格的
`SESSION_IMPORT_PROJECTION_FAILED` parent message；消息只携带 Operation ID，不携带路径、异常、Snapshot
或 raw payload。Main Supervisor 随后按既有 50ms/250ms、restart backoff 和新 Host epoch 流程替换 Host。

Transport timeout 只保护握手、查询、同步 control mutation 和 accepted ACK：握手、状态查询与
accepted ACK 为 5 秒，普通查询和 Session Catalog query 为 15 秒，replay-safe control mutation 为
60 秒。控制类请求在第一次 transport failure 后只允许一次同 key retry；Operation 本身没有 transport
timeout，由 terminal event、abort、Host epoch 和恢复语义管理。超过该同步边界的 mutation 应迁移为
accepted Operation，而不是继续扩大通用 request timeout。
同步 request 超时使用结构化 `REQUEST_TIMEOUT`，不能伪装成 `CONNECTION_CLOSED`，也不能因此触发
同 Host 的 transport retry；只有 Port close、message error 或 Host epoch 替换才属于连接故障。
`session.create` 的明确确认例外保留同creationId/idempotency key：首个ACK等待5秒后
显示正在确认，第二个等待25秒，两段ACK合计30秒以容纳签名私人记忆的冷启动。
第二次仍超时返回`REQUEST_OUTCOME_UNKNOWN`并走既有精确marker恢复；不第三次创建、
不跨Host重放、不提前发送Prompt，也不提高普通查询或通用control mutation的预算。

Host 出站事件由 `HostEventChannel` 在提交 sequence 和 operation activity 前完整校验 envelope、
payload 与 context；同进程同步调用 `HostConnectionContext.postEvent` 时只传递已校验的
`EventEnvelope`，不重复遍历 payload。连接层仍检查握手、关闭状态和协商后的消息大小，
Renderer 接收端仍独立执行跨进程校验。新增出站调用方必须先经过同一事件通道。
Host 通过独立的 `@pi67/protocol/host-event-validation` 入口，对两个 Provider configuration
事件共用的 canonical payload schema 延迟编译并复用一个 TypeBox validator；其余 schema
仍解释校验。envelope 与 context 检查共用同一实现，不缓存 payload，不接收用户 schema，
编译失败不放行。该入口不从默认 protocol barrel 导出，Renderer 不导入编译器、不放宽 CSP。

Renderer 检测到 event sequence 缺口后停止消费增量事件，只允许一次 `projection.resync`。
重同步结果在 Host 同步屏障内返回 Snapshot、Recorded Changes、Extension Catalog、Session
Catalog status、event sequence、Host epoch、session generation、active Operation 和可选的最近 terminal
receipt；Session Catalog page 不进入 resync。Renderer 在 teardown 或 sequence gap 前只捕获非终态
Operation ID：active Operation 优先恢复；若已无 active Operation，则只采用相同 ID 的 terminal receipt。
不匹配的历史 receipt 被忽略，completed/failed/cancelled/lost 也不能被迟到 accepted ACK 降级。恢复该
sequence 后才重新接收事件。旧 Port 只可完成它已经接收的相关 response，不得把 response 迁移到新连接。

Renderer 将三条 terminal 入口统一投影到 `notifications/notification-store`：实时 `operation.*` event、
accepted ACK 的 `OperationSettled` replay、以及 matching interrupted Operation 的 resync receipt。
Operation 通知按 `operation:${hostEpoch}:${operationId}` 去重；相同 ID 在不同 Host epoch 保持独立，
旧 Host receipt 不能覆盖新 Host 当前任务。历史最多 50 条、recent terminal dedupe key 最多 512 条、
可见 Toast 最多 4 条，全部只存在于 Renderer 内存。Operation notification 只存 kind/lifecycle、
Host/Session authority、时间和 error code，不存 error
message/raw details、Prompt、command、path、source 或 Tool payload。普通通知在进入 Store 前做长度边界和
凭据/链接/绝对路径脱敏，并使用五秒 dedupe window。

Pi SDK session events 不做通用深拷贝或 raw payload 转发。Streaming 只投影 renderer 实际
消费的 `text_delta` / `thinking_delta`；其他 session delta 只跨端口发送 event type。未知消息
使用安全占位，不把 raw object stringify 到 renderer；Tool argument summary 有深度、数量、
字符边界并脱敏。完整状态只在 initialize/`runtime.ready`、create/open/new-file branch/import
的 `session.bootstrap`、仍明确返回 Snapshot 的 control command result 或 `projection.resync` 中重建；日常事件不会
为了 envelope metadata 调用完整 snapshot。Bootstrap event 在对应 command response 前发送，
因此 Renderer 在首个 Approval 或 Extension 输入到达前已经拥有权威 session generation。

## Streaming and sessions

Pi JSONL 是会话真源。UI snapshot 是可重建视图，不得回写私有 session 格式。默认 bootstrap
只包含最近 100 条消息；`message.page` 使用 Pi entry ID cursor，每次最多 200 条，并受 1.5 MiB
JSON page budget 约束。单个 projected text/thinking part 最多 64 KiB，每条消息最多 16 parts；
Snapshot 和 Conversation Page 不携带图片 base64 或 data URL。可展示图片投影为
`{ id, byteLength, sessionGeneration }`；不支持的 MIME、损坏 base64、空图片或超过 10 MiB 的图片
保留明确不可用占位，不把原始数据跨进程发送。

Agent Host 为当前 Session generation 维护最多 512 个可丢弃 Asset handle，懒解码缓存最多
64 MiB。`asset.read` 属于 Query lane，每次最多返回 1 MiB 新 `ArrayBuffer`，response 通过结构化克隆传送，不把 `ArrayBuffer` 放入 Electron Host Port 不支持的
transfer list；Host 在读取前同时校验 Host epoch 和 Session generation。Session bind/reset、Host restart
或 epoch replacement 会使旧 handle 失效。Asset Registry 不写 SQLite 或 Pi JSONL。

Renderer 只有在虚拟化 Transcript 实际挂载图片时才分块读取，完成后生成 Blob URL；二进制和
Blob URL 不进入 Zustand。Renderer 缓存最多 64 项 / 64 MiB，零引用 URL 保留 10 秒以吸收快速
滚动重挂载，Host replacement 时立即 revoke。当前不提供 `asset.release` command：Virtuoso 的
卸载/重挂载不能删除仍被 settled message 引用的 Host handle；Host 侧由 generation、epoch 和有界
LRU 生命周期回收。

Agent Host 在 Session bind 时对 `SessionManager.getEntries()` 执行一次全量读取，构建可丢弃的
`SessionProjectionIndex`。Catalog live metadata、usage totals、活动 branch cursor lookup、tree source、
Conversation page 和 Recorded Changes 共用该索引；`entry_appended` 增量维护，leaf 导航只从已有
entry map 重建活动 branch。Bootstrap、`usage.changed`、`session.tree` 和 Catalog upsert 不得各自
重新复制并扫描完整 entries。若 SDK 直接写入消息后才收到 Extension checkpoint 的
`entry_appended`，缺失的 parent 或未知 leaf 必须触发一次权威 entries 重建并递增 revision，
不能因 checkpoint leaf 已知而把不完整 ancestry 投影为空对话；连续追加仍保持增量路径。
索引只持有 SDK entry 引用和派生 metadata，不写入数据库，也不改变
Pi JSONL 或 `SessionManager` 的所有权。用户消息导航只缓存活动 branch 中的 entry position；
`message.index` 按请求的 100/200 项窗口投影 bounded preview 和附件计数，不在 Session bind 时
对全部历史消息做脱敏和字符串归一化。

Session tree 是 flat projection，最多 512 nodes / 128 KiB JSON；活动节点优先，`truncated`
和 `total` 明确表达裁剪。Renderer 使用 Virtuoso，不递归挂载完整树。Tree 不进入宽 App Store：
`sessionTreeStore` 独占 projection、loading/stale 状态、change revision 和 request revision，
`session-tree-controller` 独占 `session.tree` transport。`tree.changed` 必须先通过 Renderer Session
authority，再触发单飞刷新；刷新期间的新 dirty signal 合并为一次 trailing query，旧 Host、旧 Session、
旧 generation 或旧 projection 的成功/失败结果均被静默丢弃。

Streaming delta 在 Agent Host 内批处理，renderer transcript 使用 variable-height virtualization。
`conversationStore` 独占 settled messages、page cursor、Virtuoso anchor、older-page loading 和
stale request guard；`liveTurnStore` 按 Operation 保存合并后的 text/thinking chunks。Live Turn
使用独立 Footer，不进入 settled array，也不再让 stream batch 更新宽 App Store。流式代码只显示
纯文本，settled page 到达后才清空 Live Turn 并进入 Worker 高亮。

当前活动 Session 使用 JSONL watcher，但 `fs.watch` 只提供 dirty signal，不作为变更事实源。既监听
文件内容变化，也监听父目录中的 delete/replace/recreate；75 ms debounce 后由单飞 tail drain 重新
`lstat/open/fstat/realpath`，校验 regular file、单 link、canonical path、`dev + ino + birthtime` identity、
byte offset、strict UTF-8、完整 JSON object 和 physical line。每个 read chunk 为 256 KiB，每次 drain
最多 4 MiB，连续最多 64 次并在 pass 间让出 event loop；单行沿用 import 的 64 MiB 上限。文件首次
尚未落盘时从 offset 0 开始，只有 header/entries 与当前 Pi `SessionManager` 完全对应才吸收为自身写入；
已有文件只接受此前未观察且已存在于当前 Manager 的新 entry ID，重复 ID、blank line、未知 record、
partial terminal line 或 malformed JSON 都 fail closed。这样覆盖 Pi `message_end` 先发事件、后同步写入
JSONL 的真实顺序，而不依赖易漂移的 mtime baseline。

append、truncate、same-size mutation、atomic replace、delete/unavailable、symlink/hardlink/indirection 和
invalid JSONL 会锁存当前 Session conflict；运行中的 Pi turn 会立即请求 abort，之后所有 Prompt、Queue、
model/thinking、compact、rollback/name、branch 和 resource reload mutation 在 Runtime 边界返回结构化
`SESSION_CHANGED_EXTERNALLY`。`session.externalChangeDetected` 只跨进程发送 typed reason 与
recoverable，不发送 path。Session generation 切换同步 dispose 旧 watcher，迟到 drain/callback 不能污染
新 Session。该机制是并发 writer 的检测和止损，不是外部 append merge；Desktop/TUI 仍必须顺序使用。

Queue 事件会传输用户需要查看的 steer/follow-up 文本，但 UI 最多挂载 20 条、每条最多展示
500 字符并清理控制字符。`queue.clear` 是 Queue Lane 的有序 barrier：已经开始进入 Pi 的单条 delivery
先完成；已被 Agent Host admission 但尚未执行的旧 generation delivery 以 `STALE_OPERATION` 取消；随后
Runtime 原子清除 Pi 已接收的 steer/follow-up 队列；clear 之后的新 delivery 排在 barrier 后。响应只返回
`steeringCount`、`followUpCount` 和 `pendingCount` 三类数量，分别表示 Pi 已清除的两类消息和 Host 已取消的
未开始 delivery，不把 Prompt、path、command 或其他原始 payload 再次回传或写入日志。

### Disposable Session Catalog

Pi JSONL 始终是 Session 真源。Electron Main 将 Catalog 目录固定在自己的 `userData` projection
路径并覆盖外部同名环境变量；创建路径时逐级拒绝 symlink/junction 类间接路径并验证 canonical
containment，Agent Host 打开 DB/recovery 前再次拒绝 symlink、非普通文件和多 hard-link 文件。
POSIX 上 Catalog 目录必须收紧并验证为当前用户拥有的 `0700`，DB 必须为当前用户拥有的 `0600`；
`chmod`、最终 mode 或 owner 验证失败都会 fail closed 到 SDK fallback。Windows ACL 需要独立平台证据，
不从 POSIX mode 测试外推。
Renderer 和 command payload 都不能选择数据库位置。Agent Host 的
SQLite 只保存 bounded metadata：opaque physical JSONL identity、Session path/id/cwd、显式 `session_info.name`、modified time、
message count、parent path 和 Catalog revision/status。它禁止保存 Prompt、Assistant、Thinking、
Tool payload/output、源码、Patch、图片/data URL、transcript 或 FTS 数据；无显式名称时仅返回固定
`Untitled session`，不从首条 Prompt 派生名称。

`session.catalog.query` 支持 workspace/all scope、服务端 NFKC 搜索、最多 100 项的
`modifiedAt DESC, path DESC` keyset page 和 1.5 MiB JSON page budget。Cursor 通过 SHA-256 query key
绑定 source、workspace、scope、NFKC-normalized search、sort contract 和 Catalog revision；跨结果集复用
或旧 revision 都返回 recoverable `STALE_SESSION_CATALOG`，Renderer 清空旧页并重新请求第一页。
`session.catalog.changed` 只携带 revision/reason，不能重复发送 Session 数组；
`projection.resync` 也只恢复 status/revision。
Renderer 的 `sessionCatalogStore` 是纯分页投影和请求状态机：first/next page target 都绑定本地
request revision，Workspace/Host reset、Catalog revision change 或 resync status change 会立即使旧成功和
失败失效。`session-catalog-controller` 独占 `session.catalog.query` transport、Protocol error 分类、
`STALE_SESSION_CATALOG` 首屏重载和 changed-event refresh；Command Palette 的独立服务端搜索也经过
该 Controller，但不写入 Navigation Catalog Store。

NFKC 只用于用户搜索和 SQLite search columns，不参与 source/workspace 文件系统身份。路径 fallback
保留平台原生 resolved path 的精确拼写，不再对整条 Windows 路径 lowercase；现存 JSONL 以
`device + inode + birthtime` 物理身份去重，writer lease 还为未创建路径绑定物理 parent 与精确 leaf。
Catalog schema v3 将该 opaque 物理身份贯穿 discovery、pending upsert、fallback、Protocol 和 SQLite，
以 `file_identity` 为 PK、`path` 为唯一 locator；相同 Pi Session ID 的不同物理文件仍保留为两行。
增量 upsert 遇到同物理身份不同 Session ID，或同 locator 不同物理身份时 fail closed 并触发完整 reconcile。
source-key 算法使用 `session-catalog-source-v3` 前缀，变更后旧的可丢弃 projection 会自动 rebuild。
任何 transaction 或 upsert 改变数据集时 revision 必须严格
递增；后台 discovery 开始后完成的 current-Session upsert 通过 mutation generation 合并，不能被
较旧的 reconcile 结果覆盖。

Warm cache query 不读取 JSONL。首次或显式 refresh 在后台 single-flight reconcile：Pi SDK discovery
投影出安全 metadata 后，以一个 SQLite transaction 原子替换；source key 仅随 agent directory 或
configured Session directory 改变。损坏或 schema mismatch 只替换可丢弃 Catalog，不触碰 JSONL；
`SQLITE_BUSY/LOCKED` 不 rename/delete DB，并在有界退避期间使用 metadata-only SDK fallback。
运行期 query/upsert 失败也会立即失效旧 revision，进入 rebuilding 并自动重建完整 SDK fallback，
不会长期伪装成权威空目录。`quick_check` 之外还验证 state 非负、row count 一致和 bounded metadata；
逻辑损坏与 schema mismatch 一样只替换可丢弃 Catalog。Schema 创建与校验复用同一组 canonical DDL，
open 时精确验证两张 `STRICT` table 的 `table_xinfo`（列顺序、declared type、nullability、default、
PK、hidden/generated、rowid mode）、foreign-key 空集合、两个分页 index 的 key column/cid/order/collation、
`sessions.file_identity` PK 与 `sessions.path` UNIQUE autoindex，以及完整 `sqlite_schema` object inventory。额外 table/view/trigger/index、
`ANALYZE` 生成的未受控统计表、缺失或放宽的 `CHECK`、PK/`STRICT`/index 合同变化都会触发 rebuild。
`sqlite_schema.sql` 使用有界 token fingerprint：最多 32 KiB / 4096 tokens，只忽略 token 间 whitespace
和 comments，对未引用 token 做 ASCII case fold，保留 quoted value/identifier、Blob、number、operator 和
token boundary；malformed、未闭合或超限 SQL fail closed。

Catalog 的 persistent SQLite connection 在同一个 `BEGIN IMMEDIATE` 中完成 create/validate 和
`PRAGMA data_version` / `schema_version` baseline capture，关闭 validation→baseline writer gap；另一 writer
持锁时 open 返回 bounded busy fallback，不能把竞争误判成 corruption 后 rename。`getState` / `query` 在
读取前后比较同一 connection 的 baseline，避免 COUNT/page 跨外部 commit 混合；`replaceAll` / `upsert`
先 fast-fail，再取得 `BEGIN IMMEDIATE`，在锁内重新比较 baseline、读取 revision 并写入，commit 后通过完整
guarded state read 才返回或清理 recovery。自身 data commit 不刷新该 connection 的 `data_version`，因此
baseline 固定不变；第二连接只读不会误报。发现外部 data 或 schema commit 时抛出结构化
`SESSION_CATALOG_CHANGED_EXTERNALLY`，上层立即关闭旧 SQLite、增加公开 revision、进入 SDK fallback /
rebuilding 并调度 bounded discovery。Retry 重新打开 SQLite 后，在完整 JSONL discovery `replaceAll`
完成前不能恢复增量 upsert fast path；期间 current-Session upsert 只更新 fallback 并保留 pending mutation，
由下一次完整 reconcile 合并后再切回 SQLite，外部独有 rows 不得重新进入公开 projection。
该合同用于 fail-closed 检测，不等于同用户恶意进程隔离或跨平台
single-owner lock；文件替换、恶意重写 version cookie、多 utility-process 和 Windows lock timing 仍需独立证据。
Catalog 当前继续使用 DELETE journal。WAL 的 main/`-wal`/`-shm` private-file 校验、checkpoint、整组隔离、
外部 writer detection 和 Windows Defender/同步盘锁定尚未形成同等证据，因此不与 schema v3 同时切换。
当前 Pi SDK `0.86.1` 的 cold discovery 内部仍会临时构造 `allMessagesText`，但该值在适配边界立即
丢弃，不进入 SQLite、Protocol、Renderer、日志或 diagnostics。当前不实现 FTS 或明文 transcript index；
活动 Session watcher 与 Catalog metadata discovery 保持独立，前者不会把 JSONL entry 写入 SQLite。

#### Content search worker ownership

会话内容搜索的 HMAC token 索引由单个 Node Worker 独占读写。Host 的 Catalog 目录下
`content-index-worker/` 保存独立的可重建 SQLite 文件；沿用 Catalog schema/私有权限与恢复
校验，并保存索引查询所需的 metadata 副本。它不是目录、会话或组织状态真源。旧 Catalog
中的内容表保留供源码回退，但前台不再写入或查询它们；不迁移或删除 Pi JSONL。
每次 Worker 请求使用 Host 当前 metadata snapshot 替换副本并淘汰不在 snapshot 中的索引；
搜索仍按当前 workspace/归档状态过滤，并从 JSONL 验证候选正文 fingerprint。
返回结果前核对 Host source generation 和 Catalog revision，变化则返回
`STALE_SESSION_CATALOG`，不能接受旧 metadata 的搜索结果。

Worker 使用自己的 SQLite connection 和文件，不与前台目录库共享写锁。每个 Catalog owner
至多一个 Worker、一个执行中的请求和八个未完成请求；metadata snapshot 有 100000 条记录及
16 MiB 保守字符串大小预算，超过预算走显式 incomplete 的现有有界搜索回退。每请求 30 秒
截止；失败/取消执行中的请求、source reset 和 dispose 会终止 Worker，等待旧实例退出后
才能创建新实例。排队中的搜索取消立即返回，且在执行前再次检查取消状态。独立库事务
保持原子提交，进程退出后的未完成事务由 SQLite 回滚；下一次请求重新校验和重建。
Worker 不运行 Agent loop、Provider 或 Tools，不记录消息正文、原始请求或 salt。Worker
故障不会伪造完整索引；显式搜索沿用 bounded JSONL fallback 并标记 incomplete。

### Pi Session Recorded Changes

`workspace.changes` 和 `workspace.changeChanged` 只投影当前 Pi Session 活动分支中的 `edit` /
`write` Tool 事实，不扫描 Git，也不声称覆盖外部进程或其他工具产生的工作区变化。最多保留
100 项、每条 path 最多 1 KiB、Edit Patch 最多 64 KiB、整个 projection 最多 512 KiB。

- `edit`：完成后的 Pi Tool Result 同时提供 `patch`、`diff` 时，才投影 unified Patch、首个
  变化行和增删行；失败、缺失或已截断 Patch 不生成未经证实的统计。
- `write`：只投影输入的有界 byte/line metrics。Pi Tool Result 没有写入前版本，因此 Desktop
  明确不生成历史 Diff。
- Bash 和未知 Extension Tool 不根据 command、summary 或猜测字段生成文件变化。
- Live update 以 Pi `toolCallId` upsert。Session bootstrap 先清空旧 projection；sequence gap
  后只使用 `projection.resync.changes`。`workspaceChangesStore` 以 Host/Session authority、feature
  projection revision 和 request revision 同时约束 query 成功与失败，延迟结果不能覆盖新 Session，
  Port teardown 后的旧 rejection 也不能改写恢复状态或发布噪声通知。

## Renderer state flow

### Agent event projection map

`apps/renderer/src/app/renderer-agent-event-controller.ts` is the single entry for a validated
Agent event after connection sequence checks:

```text
validated Host event + envelope
  -> applyRendererAgentEvent
      -> workbench Task summary router (all registered Tasks)
      -> selected live App/Session projection (active or unscoped events only)
      -> feature stores owned by the live projection
      -> projection-freshness observer (accepted live events only)
```

The Workbench Store owns the bounded multi-Workspace/Task index used by navigation. It may retain
background Task lifecycle and runtime summaries, but it must not own a background transcript or a
second full Session projection. App, Session, Conversation, Live Turn and their feature stores own
detail for the selected Task only. A Task-scoped event rejected as `background` or `stale` must not
reach the selected live projection.

Formal Workbench identity is `workspaceId + sessionFileIdentity`; `sessionId` remains a Pi business
check and `sessionPath` remains a display/open locator. Workbench persistence v4 therefore accepts
the opaque physical identity emitted by the authoritative Snapshot even though its internal format
may contain separators. Task context, running Operation, accepted and settled receipts all use
the existing `MAX_SESSION_FILE_IDENTITY_CHARS` bound for this field; other protocol identifiers
retain their own bounds, and the envelope byte limit is unchanged. It persists live Runtime recovery without consulting the disposable Catalog.
The v3 migration never promotes a path-only formal record into physical identity: it drops formal
runtime recovery and falls back to the Workspace surface, while retaining a provisional selection
only when a matching durable `creationId` recovery record exists. Catalog reconciliation may update
title and locator metadata for an already materialized identity, but it cannot materialize a
provisional Task.

The two views are intentionally allowed to differ only at explicit transition boundaries: a lost
Workbench Task may coexist briefly with a recovering live projection, and Settings keeps its return
Task active while the Settings surface is selected. Outside those windows, active events are applied
to the Task summary before the live projection so a new authoritative `session.bootstrap` can update
Task identity before installing Session detail. `WorkbenchProjectionBridge` remains a compatibility
projection for workspace registration and non-event-derived Session metadata such as name/path and
recent user-message preview; it is not an alternative Agent event reducer.

Session authority remains
`hostEpoch + sessionId + sessionGeneration + projectionRevision`. Installation, control transition,
import watchdog and resync details stay in their existing focused modules; this map is the stable
entrypoint for callers and does not collapse those distinct recovery responsibilities into a broad
facade.

```text
MessagePort
  -> AgentConnectionController
  -> Protocol decoder / hostEpoch / sequence checks
  -> typed projection and operation reducers
  -> App lifecycle state / conversationStore / liveTurnStore / feature stores
  -> React
```

Raw `AgentPortClient` 不进入 Zustand。宽 `SessionSnapshot` 只保留在 bootstrap、强制 resync 和
Session lifecycle response 边界；model/thinking/runtime key、workspace trust 与 resource reload
返回只包含命令实际拥有分组的窄结果。宽 Snapshot 进入 Renderer 后会拆成分组的 `sessionProjectionStore`、独立 Conversation projection、
Session Tree projection 和 Operation-scoped Live Turn。Session Projection Store 不保存一个供 UI 宽订阅的
聚合对象，而是分别保存 identity、model/provider controls、queue、resources 和 usage。
`session/session-authority.ts` 与 `sessionProjectionStore` 以
`hostEpoch + sessionId + sessionGeneration + projectionRevision` 定义并持有当前 Session authority；
`renderer-session-transaction` 统一处理 workspace/session replacement、same-Host resync、Port teardown、
Host replacement、runtime crash 和同 Session control transition。Session 切换、Host replacement、
sequence-gap 和 transition 会在一个同步 transaction 中失效旧 event/response target、分页请求、
Conversation、Live Turn、Recorded Changes 与 interactive projection，旧成功和旧 rejection 都不能跨
transaction 写回。新 Host 或新 Session 只能由携带明确 generation 的 `runtime.ready`、
`session.bootstrap` 或 `projection.resync` 安装 authority；普通增量事件不能激活 authority。同一 active
Host/Session 的 control response 可以复用当前 generation，缺失 authoritative bootstrap 时显式失败，
不能从后续普通事件猜测或采用 generation。
Snapshot replacement 使用单一 canonical authority 的两阶段提交。`sessionProjectionStore` 先进入带新
`projectionRevision` 的 inactive installation；Conversation、Session Tree、Recorded Changes、Extension
Catalog 和 resync Catalog status 依次安装，并在每次同步 Store publish 后重新验证 installation。只有全部
feature projection 仍属于该 revision 时，Session identity/controls/queue/resources/usage 才作为最后一步提交
active authority。任何 subscriber 重入、Host/Session replacement 或 recovery transaction 都会推进 revision，
使旧安装立即停止；旧失败路径不得 reset 或清除更新 transaction。authority module 只保存 transaction phase
和 revision，不在 App Store 或额外 coordinator Store 复制 Host/Session identity。
`extensionUiStore` 独占 pending request、status/widget、
compatibility、Catalog 和临时 title；App Store 只消费 Host 已投影的 Operation activity，不从 blocking
Extension 或 Approval Dialog 的本地开关推断等待状态，也不持有 Extension UI 副本。Renderer 在发起 Session/resource transition 前清理该
Feature Store；Host replacement、runtime crash 和 sequence gap 也显式清理，resync 只恢复权威
Extension Catalog。`approvalStore` 独占 pending Safety Approval request；Host 的 Activity Controller
维护 Pi base activity 与 Approval/Extension interactive overlay，终止交互后恢复最新 base activity。
Approval 和 Extension Store 通过 Session transaction 随 transition、Host replacement、runtime crash
和 sequence gap 一起失效。Pi Runtime 会在 `runtime.ready` / `session.bootstrap` 之前发送新 generation
的 `extension.catalog.changed`；Renderer 不再用“generation 未知即接受任意 Session”的旧路径，而是
只在当前 Host/projection revision 下暂存 catalog，等 bootstrap 的 Session ID 与 generation 精确匹配后
再安装，不匹配即丢弃。App Store 只管理 connection、runtime、workspace/trust、Operation、Doctor 状态和
Dialog 投影，不再发起 MessagePort request，也不保存 Session identity/generation/revision/authority phase、
Session view 或 UI metadata 副本。Workspace、Session lifecycle/import/control、Prompt/Queue、Operation command
和 runtime diagnostics 分别由 feature controller 直接持有 transport、authority fence 与失败投影；React 只调用
这些领域入口，不通过 Zustand action facade 间接访问 Agent Host。
`session/session-projection-selectors.ts` 是当前 Session view 的只读消费边界，不拥有 transport。Transcript
只订阅 Session ID，Navigation 只订阅 Session ID/path，Trust 只订阅 Session 是否存在；Composer、
Context、Credential、TitleBar 和 Command Palette 使用 feature-scoped selector。增量
`usage.changed`、`tree.changed`、`queue.changed`、resource 或 model 更新只通知实际消费对应投影的
surface。同步 control request 捕获每个分组的 revision；迟到 response 只能更新请求期间未变化且由该命令
拥有的分组。`workspace.setTrust` 与 `resource.reload` 使用
`SessionResourceCatalogResult`，只携带 `sessionId`、controls、model catalog 和 resources，不再投影或跨
MessagePort 复制 messages、tree、queue、usage 与 Session identity。`workspace.setTrust` 的 success、error
和 finally 还同时绑定 Workspace、Host、Session 和本地
request revision，旧请求不能覆盖新恢复状态或清除新 transaction 的 pending 标记。
`model.list` 与 `resource.list` 也直接读取各自的窄 Runtime projection，不得为了返回一个数组构造完整
`SessionSnapshot`。
`workspaceChangesStore` 独占 Session Recorded Changes projection、同步状态和有界 `toolCallId` 索引；
Transport request 位于独立 controller。`ChangesPanel` 和 Tool Card 不再订阅 App Store，Operation、
Runtime、Queue 或 Dialog 更新不会重复扫描修改记录。
Notification history 已迁移到独立 `notificationStore`，App Store 不再持有 notice 数组。Toast dismissal
只移除瞬时呈现，不删除历史；打开 Notification Center 只更新 read state，不触发 Agent 命令、Session
切换或 Operation 状态变更。

## Safety and resource limits

- Shell approval follows the validated Tool identity, current mode, exact targets,
  and conservative syntax/side-effect classification, never a command-prefix grant.
  AUTO permits classified bounded local checks, Workspace scripts/dependency changes,
  and non-destructive local Git operations. Unclassifiable AUTO Shell returns a
  corrective Tool Result without a meaningless approval dialog. Recognized destructive
  actions require exact one-shot confirmation before installed-capability AUTO grants
  and YOLO; ASK keeps the verified read-only exemptions below and otherwise requires
  one-shot approval, while PLAN remains read-only.
- Safety Approval 与普通 Extension `confirm` 使用不同 event、pending registry、Store 和 Dialog。
  Approval 绑定 `hostEpoch + sessionId + sessionGeneration + operationId + requestId + toolCallId`；
  Port 不可投递、session/operation 过期、requester 异常、等待期间 abort 或 target/cwd 无法完整
  展示时立即拒绝，不能等待超时后继续执行。
- Pi `0.86.1` 中用户 Extension 先运行，Desktop inline Safety Extension 后运行；Safety 因而检查
  其他 Extension 修改后的最终 Tool 输入。真实 Pi ordering contract test 固定该属性，SDK
  升级若改变顺序必须失败。
- Project trust enables project resources and is distinct from Tool approval.
  An enabled, admitted Package/MCP capability with a unique effective Tool identity
  grants AUTO execution for its registered side effects, except recognized destructive
  actions. In AUTO, external, system and Workspace-external actions outside that
  grant and the explicit read-only exemptions require one-shot approval. Those
  exemptions cover canonical Workspace reads, capability inspection, verified
  read-only web Tools, read/search/list inside a Skill directory already loaded by
  this Session's Pi ResourceLoader, and exact canonical-file read/search for other
  loaded resources (never directory listing by that file grant); they never grant
  writes or arbitrary home-directory reads. Invalid identity/schema/route/target remains fail-closed
  in every mode; loaded resources alone never create an installed-capability grant.
- Session import performs a streaming preflight before creating a managed copy:
  the file is limited to 256 MiB and each physical JSONL line to 64 MiB,
  including a final line without a trailing newline.
- Diagnostics and tool summaries use bounded redaction; credential values、raw
  Prompt、source bodies and raw tool payloads do not enter default logs.
- Prompt attachment staging uses one UUID run root per app instance. After Main owns
  the single-instance lock it scans only direct UUID directories, skips the current
  run, links/junctions and non-directories, and removes at most 16 roots older than
  24 hours through a same-parent atomic quarantine rename. Failure is background-only;
  logs contain bounded counts and error classes, never attachment names or paths.
- Path-backed staging binds picker size/mtime and physical file identity to one
  non-following handle, copies and hashes from that handle, then compares a second
  handle stat before publishing the manifest. Supported PNG/JPEG/GIF/WebP content
  has a 32 MiB aggregate native-image budget independent from the 250 MiB ordinary
  attachment budget. Renderer applies it to the complete draft from Main's staged
  metadata and Host applies it before accepted publication; unknown `image/*`
  declarations remain ordinary files instead of entering Pi native image content.
- Agent Host claims are stored under hashed Task and submission directories. A
  claim copies from each revalidated non-following payload handle into a temporary
  directory, syncs its payloads/manifests, atomically publishes the set, and removes
  draft copies only after commit. Pre-commit failure therefore preserves retryable
  opaque draft references. New claim admission and replacement recovery share the
  same 128-set Task ceiling; an existing submission replay does not consume a slot.
  A replacement Host may recover only the requested set for that exact Task, scans at
  most 128 claimed sets, and revalidates the directory inventory, item metadata,
  regular-file identity, byte length, and SHA-256 before restoring the in-memory
  index. Tool reads revalidate and read the selected item from one handle, then
  transfer immutable bytes to a Worker without reopening a payload path. Explicit
  Task disposal removes its claimed directory only after Runtime disposal succeeds;
  cleanup failure remains retryable. Host replacement does not remove it, and Main
  removes the complete run root only after Host shutdown. Archive workers enforce the same
  entry limit for list and read plus full-archive path depth/name length, expanded
  bytes and compression-ratio validation, bounded execution time and worker memory,
  and truncation-aware output size.

## Extension UI

`select`、`confirm`、`input`、`editor`、notify、status 和文本 widget 映射到可访问的 React
UI。`ctx.ui.custom()`、component widget/footer/header/editor 和 TUI autocomplete 不允许
注入 renderer，必须报告 `tui-only` 或抛出明确兼容错误。当前 SDK 未提供可靠的 calling
extension identity，因此 capability 明确声明 `attribution: none`，不得伪造 extension ID；
Host 只补入其权威拥有的 epoch/session/operation context。Session transition、resource reload、
projection resync、abort、timeout 和 runtime dispose 都取消 pending request，并通过 `extension.ui.cancelled` 清除
renderer 中对应的阻塞 UI。

普通 Extension Request 在显示和响应前都校验 Host/session/operation authority；Safety Approval
则使用独立的 `approval.requested/respond/resolved/cancelled` 生命周期。二者的取消和响应不能
交叉解析。Extension Bridge 成功解析 request 时发送 `extension.ui.resolved`，Host 在 command ACK 前
同步结束 interactive overlay；Renderer 只按该权威 event/envelope 清理领域状态。Extension response
只有在 Host 返回 `resolved=true` 后才视为已接受；`resolved=false`
会移除已失效请求并给出可观察警告，transport failure 则保留请求、返回失败并显示可重试错误，不能
向 React event handler 泄漏未处理 rejection。`approval.resolved` 和 `approval.cancelled.requests[]` 都携带
`requestId + toolCallId`；Renderer 只在这两个身份及 event envelope 的 Host、Session、generation、
Operation 仍与当前待处理请求一致时清除授权界面。
Approval response 同样只在 `resolved=true` 时视为被 Host 接受；`resolved=false` 会移除失效请求并
明确保持工具阻止语义，transport failure 保留请求并转为可观察、可重试的错误，不把 rejection 泄漏给
React event handler。

`packages/extension-compat` 提供纯 TypeScript 的声明式 Manifest v1 校验、SemVer 匹配和
immutable Registry；它不 import Pi SDK、Node、Electron 或 React，也不加载文件或执行 Adapter
	代码。内置 Adapter 还必须先通过 conformance inventory：证据固定 npm sha512 integrity、license、
	canonical HTTPS repository、完整 Git object id、repository-relative source path、精确 installed SemVer
	和观察到的 command/tool surface，
	Manifest 不能声明证据中不存在的 surface。Agent Runtime 只信任 Pi resolved package
`baseDir/package.json` 的 name/version，并以 Pi
最终 resolved command catalog 与 `AgentSession.getAllTools()` 作为 surface 真源。Runtime capability
报告 `adapterRegistry.available: true`、schema version、已接通的 `commands/tools` surface 和真实
	active count；production built-in inventory 当前覆盖 `pi-rewind@0.5.0` 的 `/rewind` command
	metadata，以及 `@feniix/pi-sequential-thinking@5.0.3` 的八个静态 Tool surface。
	该 Extension 的快捷键/TUI surface 仍按 runtime 事实标记为 `partial`，不能外推成完整兼容。

命令 Adapter 元数据随 `command.list` 返回。工具 Adapter 在 `tool_execution_start` 按
Session generation + `toolCallId` 固化，完成后只在当前 generation 的 bounded settled cache 中保留，
再进入 Message projection；历史 JSONL 缺少本进程绑定时保持 generic，不按当前同名工具猜归属。
`realtimeUiAttribution` 和 shared `ctx.ui` caller attribution 仍为 `false/none`。`working indicator`、
直接修改 Desktop composer、custom component 和 autocomplete 继续以结构化 limitation 公开，不能
把 common primitive bridge 或声明式 command/tool Adapter 描述为完整 Extension UI 兼容。

`extension.catalog.list` 与低频 `extension.catalog.changed` 使用独立、有界 projection，不把
Extension 目录塞回 `SessionSnapshot`。目录最多投影 128 项和 1.5 MB JSON，过滤 `hidden` 的 Desktop 内部
Safety Extension，并按 `commands`、`tools`、`ui-primitives`、`tui-custom` 四个 surface 分别
报告。Pi 已解析的 command catalog 是 invocation name 的权威来源；Desktop 不再从 raw
`extension.commands` 猜测命令冲突后的名称。加载成功但证据不足时必须显示 `unknown`，不能
默认标记 `native`、`headless` 或 `adapter`。`projection.resync` 同时恢复该目录，避免 sequence
gap 后保留旧 Host 或旧 Session 的 Extension 状态。

## Desktop capability implementation contracts

- Renderer-owned Pi Desktop Slash actions must call the existing feature
  Controllers. Do not send `/new`, `/model`, `/compact`, `/resume`, `/tree`,
  `/reload`, `/settings`, `/plan`, or `/default` through `command.invoke` or as
  model Prompts.
- Plan and Search are first-party Pi SDK capabilities. Desktop Tasks must not load
  `@narumitw/pi-plan-mode`, `pi-web-access`, or `pi-smart-fetch`; preserve existing
  user settings until an explicit uninstall. Renderer Plan implementation requests
  contain only `planId + submissionId`, never Plan Markdown.
- `Groland` is one built-in mixed-protocol Provider with one credential. Keep
  authoritative model membership and protocol mapping in `packages/domain`:
  Claude-family members use Anthropic Messages and GPT-family members use OpenAI
  Responses. All Groland members support text, image, and reasoning. Native-search
  UI is a declaration, not live verification, and a sent native request must never
  silently fall back.

## Source layout

- Desktop Main：`app-protocol`、`main-window`、`agent-host-supervisor`、`system-bridge` 分别拥有
  scheme/window/process/system 能力，`main.ts` 只做组合。
- Agent Host：`host-server`、`command-scheduler`、`operation-registry`、`operation-submission-ledger`、
  `control-mutation-ledger`、`connection-context` 和 `protocol-error` 分离协议、并发、Operation/watchdog、
  submission/control 幂等重放与错误映射。
- Main Supervisor 只接受 `packages/protocol/supervisor-messages` 的严格 startup ready/failure、
  poisoned-runtime 与 shutdown request/completion message；malformed 或携带额外 raw state 的 parent
  message不触发 readiness、kill 或 deterministic failure，也不能伪造 graceful shutdown completion。
- Renderer：`connection` 独占 Port 和有界 control-mutation retry，`conversation` 独占 settled page 与分页控制，`live-turn` 独占
  流式 chunk，`approval` 独占 Safety Approval projection/response lifecycle，`extension-ui` 独占普通 Extension UI
  projection/response lifecycle，`notifications` 独占内存通知历史、
  Toast 生命周期和 terminal dedupe；`operation`、`tool-cards` 和 feature 目录拥有 UI。基础样式位于 `styles`，
  feature-specific 样式使用 colocated CSS Modules。
