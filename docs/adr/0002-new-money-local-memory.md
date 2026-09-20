# ADR 0002: New Money local memory and shared knowledge

Status: accepted; implementation and platform validation pending.
Date: 2026-09-08

## Ownership

New Money Desktop and newmoney.52671314.xyz are one product. The independent
new-money-server sibling owns accounts, teams, project membership, entitlements,
review, immutable shared versions, synchronization and audit in VPS PostgreSQL.
Desktop owns Pi execution, Pi JSONL conversation truth, a local OpenViking sidecar,
private memory and disposable shared projections. DataHub is only an optional
connector. No server-hosted OpenViking, local PostgreSQL or implicit private upload.

Server publication contract (2026-09-16 source cutover): default candidate
`publish` and its retained `publish-versioned` alias use the same PostgreSQL
transaction and return a publication receipt (201 first / 200 authorized replay),
not the old SharedAsset summary. The receipt does not certify active state or
Desktop indexing/search readiness. Web reviews explicit candidate content and
confirms revocation against the current detail's exact strong ETag; stale versions
require fresh review. Desktop's independent live fixture still uses the alias.
No Desktop runtime import/build dependency, implicit legacy migration, keyword
fallback, deployment or production-state change follows from this source cutover.

Approved on 2026-09-12: Main may independently issue read-only HTTPS team/project
authorization requests to the signed-in service using secure-store credentials.
This narrow exception avoids trusting Host-supplied grants or adding server signing
keys. Main does not refresh credentials, transport knowledge or invoke models;
Host retains other business networking. Receipt authorization never grants model
processing rights. Redirects/fallback are forbidden and requests must be bounded
and cancelled on identity/Host invalidation.

Approved continuation on 2026-09-12: extend the managed local OpenViking adapter
so every team-derived extraction/embedding request, including retries, passes a
Host-owned purpose-specific model authorization boundary. Do not reuse the private
connection or broaden Main's authorization-only networking exception. The native
adapter, lifecycle wiring and packaged proof remain implementation work, not claims
established by the Host guard's synthetic tests.

## Storage and identity

Private activation is a separate Main-owned explicit preference, default off.
The supported macOS application keeps the managed route authoritative even when
consent is off, so no legacy endpoint fallback is selected. Saving enablement only
takes effect after a new app launch; Host recovery is not an activation shortcut.
Disable fences connection delivery and waits for service cleanup without deleting
private data. Unknown persistence and incomplete cleanup remain distinguishable.
Approved cold-start follow-up (2026-09-20): saved enabled consent permits one
background service preparation after Main observes the current Host ready. It
does not block window/port readiness, create a Session or invoke a model. Normal
signature/tree validation, configuration resolution and scope provisioning remain
mandatory. Concurrent Session connection joins the same launch. No automatic
warmup retry follows failure/Host recovery; disable and shutdown fence late results.
The last startup diagnostic stores only fixed stages, outcomes and milliseconds in
an owner-only file outside memory data; it is not proof of recall/model quality.
UI lifecycle/readiness observations do not grant capture, team access or model
authority. Signed-runtime distribution and full product/platform proof remain
separate acceptance items, not inferred from the preference workflow.
Settings uses this Main-owned lifecycle for the default memory status. Explicit
health checks inspect the existing admitted local handle without startup or model
processing, with bounded timeout and stale-result rejection. Legacy manual endpoint
configuration/probing is separate in Advanced and never selects the managed route.
The workbench follows the same managed authority: read-only parent inspection
returns an existing admitted connection, never starts one, and cannot fall back
to manual/CLI/environment routing. Private reads/search use the scoped identity
with redirect rejection and current-connection checks. Session counts come from
the loaded private owner's exact OV lineage through Pi EventBus, without guessing
an ID or creating a Session. Missing/retired owners and failed reads are unknown,
not zero capture. This source repair is not real-model extraction/recall proof.

Use Application Support/New Money on macOS and APPDATA/New Money on Windows.
Keep sessions, openviking/runtime/<version>, openviking/data and team-projections
separate. Generate a stable localProfileId independent of hosted login. Preserve
private data on login/logout and upgrades. Do not auto-adopt the development Lab.
The current macOS arm64 private installation keeps the fixed
`openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64` runtime child. Team indexing
uses a separate full installation with the `-team-index-v1` suffix. Its explicit
import verifies the signed tree and fixed v1 bootstrap before and after copying,
refuses replacement, and never redirects the private runtime. Missing team runtime
fails closed without private/development fallback. This parallel revision is not
an implicit installation, activation, data migration or production delivery claim.
Team queries use a third full installation with suffix `-team-query-v1` and fixed
signed `runtime/newmoney-team/query/v1/team_query_worker.py`. Import is explicit,
verifies both source and copy, and refuses replacement. Main's lazy `teamQuery`
composition requires a separately configured root (including canonical-path
separation from private/index roots), verifies the complete signed tree on prepare
and again immediately before launch, and pins Python/bootstrap/tree across both
checks. Each admission has a 30-second cancellation deadline. It creates no profile,
settings, staging or process and grants no read/model authority. Missing query
configuration or capability fails closed. This is source implementation plus
synthetic signature/import evidence, not actual production signing or installation.
Shared receipt namespaces bind localProfileId, canonical service endpoint, userId,
teamId and exact team/project scope. The legacy credential field accountId is the
active team ID, not a user identity: never use it in place of userId for isolation.
Under the owned `openviking/` root, receipts remain in
`team-projections/receipts/<owner-key>` and team worker staging uses distinct
`team-projections/<owner-key>/staging/run-*` directories. Runtime, private data and
model settings must not be installed inside that projection tree. Preparing team
staging reads an established profile; it does not create or repair private identity.
The internal POSIX publisher retains each verified run in place, adds its exact
`publication.json` manifest and atomically replaces the scoped owner's
`current-index.json` pointer after flushing and commit-boundary checks. A referenced
`staging/run-*` is a retained generation, never an ordinary temporary cleanup target.
Keep old generations; reset/recovery/retention and authorized reader activation are
separate work. A pointer is not a persisted permission grant. Failures after rename
starts are indeterminate and must not be presented as successful rollback or retried
automatically. The internal Host index transaction now requests publication after
worker/Main completion and early head verification. Windows support remains unwired.
Main retains successful wait results only within their original handle/indexId and
a non-renewable 90-second post-verification deadline. The private publish request
cannot supply paths or grants; Main freshly checks read access and requires an
installed exact current-Host head/model observer. Main now installs this private
metadata-only channel: Host checks current credential/configuration, both model
policies and the exact permission revision and snapshot head through the existing
Gateway. Results remain revocable across credential/configuration/power/Host
lifetimes and bounded by scope/page/credential expiry and a 90-second Main cap.
Neither private profile IDs nor paths, bodies or credentials cross this channel.
The Host's eight-second initial observation deadline now returns a negative reply
immediately, while retaining unfinished IO slots until settlement. Main's ten-second
no-reply fallback remains unchanged. Fixed local phase/outcome/millisecond diagnostics
cover head checks and body reads; they contain no content, identity or raw errors,
do not bypass authorization and do not imply live end-to-end acceptance.
The observation is not independent read authorization or a remote stream lock;
Main's separate read check and original result deadline remain mandatory. Missing
composition fails closed. A successful internal index transaction requires an exact
`published-local` reply matching its verified snapshot, confirmed cleanup and current
lifetime; it does not activate search. Main now has internal published-index read
admission, an internal one-shot vector query primitive and separate managed query
runtime preparation, one-shot private Host/Main query requests and an internal Host
metadata-search transaction and a separate exact-version body transport. User
explicit settings build entrypoints now exist; opt-in Session-bound tools are described below.
Admission requires a current receipt handle, Main-owned root/model selection, an
existing matching private profile, exact published manifest/receipt active versions
and a matching artifact fingerprint. It freshly composes independent read access
and current-Host head/model observation; historical page leases never grant access.
Any receipt append, pointer replacement, changed file or invalid authorization
blocks the old generation. This initial policy rejects the whole generation until
rebuild, rather than querying a partially stale index. A disposable 60-second
Main-only observation exposes a checker for batched exact asset/revision results,
not permission to send bodies to a model. No query engine or search cutover is
implemented by this admission layer. Lost publish replies and possible post-rename failures are explicitly
indeterminate, including concurrent account loss; they never imply safe retry.
Post-publication cleanup or lifetime failures also preserve this uncertain operation
outcome rather than claiming rollback. A confirmed Main pre-commit denial remains
an ordinary failure. Neither ordinary receipt sync nor startup triggers indexing.
An explicitly requested internal index transaction first validates configured model
policy, then catches up its exact team/project receipts under the same captured
credential and lifetime. Catch-up has a 60-second/10-page budget within the existing
four-slot/480-second index owner. Only acknowledged persistence and confirmed sync
handle closure allow index preparation and model reservation. Failures preserve
acknowledged receipt progress for a later explicit request, but never start indexing,
invoke a model, retry automatically or claim readiness. Publication still checks the
current head again; catch-up is not a stream lock. This does not enable startup/login
jobs, change the receipt-only settings action or activate canonical tools by default.
Settings has a separate explicit build action through app-scoped
`enterprise.knowledge.index`, accepting only teamId and optional projectId. Host
supplies saved models, Main owns runtime/storage, and the existing index transaction
owns admission, catch-up, cancellation and publication. The 510-second reply budget
does not extend its 480-second work budget or promise physical termination. The
command is not replay-safe and never automatically retried. Publication uncertainty
crosses the protocol as a non-recoverable `outcome: indeterminate` error; cancellation,
timeout and disconnect cannot be described as rollback. UI success records only this
confirmed publication, not current searchable readiness, and clears on scope loss.

Main can now derive model metadata from the validated publication itself, rather
than adopting a Host query model. Optional Main-provided expected models remain
strict equality checks; the stored selection still passes exact current-Host
head/model observation and independent read authorization before it is returned.
The private receipt protocol adds `shared-knowledge-index-query-prepare` (handle
only) and `shared-knowledge-index-query` (handle, one-shot queryId, vector, limit).
Preparation admits the separately installed query runtime and opens the current
reader, then returns only queryId, embedding model and snapshot. No executable,
directory, local profile, asset allowlist, query text or grant is accepted from Host.
Main application composition supplies the fixed memory root/runtime preparation.
Queries return only asset IDs, exact content revisions and scores after native
completion, working-copy cleanup and reader checks; no bodies or persistent grants.
Four per-broker query slots cover preparation, idle wait and execution under one
non-renewable 60-second deadline, in addition to the existing process-wide reader
limit. Close, identity/Host invalidation and reader retirement cancel the query;
pending preparation/execution holds its slot until settlement. A queryId is consumed
on its first execution attempt, never replayed or automatically retried. Query work
cannot share an active index job's handle. Host waits at most 70 seconds per query
phase and closes the dedicated receipt handle on cancellation/timeout/mismatch;
that close is cancellation, not proof of process exit. Existing lease-bound read/head
observations remain point-in-time, not push revocation or a lock on the remote stream.
Host now composes open→prepare→embedding→query→close through internal
`AgentHostServer.teamKnowledge.search`, with no Renderer command or automatic trigger. The same
four-slot query owner covers both embedding-only work and complete transactions,
including settings loading and cleanup. Caller, captured credential generation,
settings, Workspace retirement, power and shutdown cancel the whole transaction;
one non-renewable 60-second budget and credential expiry apply across all phases.
Main admission precedes loading the embedding source or invoking its provider.
The configured model must match Main's exact endpoint/model/dimension, and the
existing per-request team/project policy guard authorizes the user query embedding.
The result must match the prepared snapshot and requested limit. Success requires
confirmed dedicated handle close and a final current-lifetime check. Cancellation
requests close promptly while underlying model work drains; its slot stays occupied
until that work settles. Main independently retains responsibility for physical
native completion and working-copy cleanup, even when Host IO rejects earlier.
No retry, source fallback, implicit sync/indexing or extraction call is added.
Failed Host query transactions expose only a fixed local boundary label:
`receipt-open` (including Main read authorization), `index-preparation`, `embedding`,
`native-query`, or `receipt-close`. The Session query owner preserves this sanitized
error, never its upstream cause, credentials, paths, model input or body. Cancellation
keeps the active phase; independent close does not replace the original failed phase.
The label does not identify a Main substage, prove timeout versus denial, or prove
physical worker exit. Pre-transaction Session admission remains separately guarded.
Returned IDs/revisions/scores are point-in-time metadata, not reusable read/model
grants. Session provenance, body-processing authorization, product entrypoints and
packaged proof are still required before cutover.

The private `shared-knowledge-index-read` request now accepts only an existing
dedicated handle, positive snapshot, asset ID and content revision. It is a separate
read operation, not reuse of a successful query's permission. Main reopens the current
published reader with fresh independent read authorization and current Host head/model
observation. The snapshot must match before body replay. `readDocument` checks the
active manifest allowlist, then materializes validated receipt history, retaining
only the exact selected canonical document. It never reads OV-generated summaries,
private memory, arbitrary paths or stored job bodies. Receipt/pointer/artifact changes,
revocation, expired observations, cancellation or a replay mismatch withhold all bytes.
The result is returned only after complete replay and final checks. No Python runtime
preparation, native query, model call, new body file or body cache is involved.

Reads share Main's four query slots and 60-second cancellation budget; an in-flight
read retains its slot through actual replay settlement, including after close or
invalidation. The process-wide reader cap remains independent. Host's internal
`teamKnowledge.read` captures identity/scope/version and the existing settings/power/
Workspace lifecycle, opens a fresh handle, reads, verifies the canonical SHA-256 and
document structure, then requires confirmed close and current lifetime before return.
The private result bounds canonical UTF-8 bytes to 1 MiB; the shared sync parser keeps
its exact version/kind/title/summary/body and Unicode limits. Host waits at most 70
seconds for the Main read reply, closing on cancellation/timeout; Main may still be
draining IO. No retries or model permissions are implied. This internal transport
does not prove that the caller searched in the current Pi Session. Product integration
must bind the selected version to immutable Session identity, preserve provenance and
freshly admit the exact agent model before exposing any shared text. The canonical
document is not the legacy structured Experience/SOP detail; do not invent missing
fields or silently replace that interface. Existing tools and hosted search stay intact.

The internal `teamKnowledge.session.search/read` variants now add fresh Agent-purpose
admission: capture the supplied birth identity/model, require the same current user
and canonical service, and authorize the birth project with that run's credential
before Main IO or embedding. Content scope is explicitly team-wide or the birth
project, never Workspace fallback. The grant stays checked through return and its
deadline cancels pending work within the existing four-slot/60-second lifecycle.
Embedding authorization and independent Main read/head checks remain separate.
This is not yet real Pi Session binding or search/history provenance: the caller
must supply verified birth identity, retain exact selection and validate persisted
asset references before model replay. The explicit Pi wiring below selects the
runtime's model-visible tool family; it does not convert legacy history or change
Renderer commands.

Pi now accepts a typed `teamKnowledgeAccess` port through Host Workspace binding,
TaskRuntimeRegistry and PiSdkRuntime. `viking_team_search/read` share the existing
birth-identity/completion fence and model/Tool lease, not a second agent loop.
When this port is selected, only that canonical shared tool family is registered;
legacy `viking_shared_search/read` and `viking_sop_search/read` are not exposed
alongside it. Missing local readiness or an operation failure never changes this
selection. Without the canonical port, the legacy compatibility tools remain.
Legacy read ports still serve the separate historical authorization check; old
Pi JSONL content is neither converted nor erased by this tool-discovery change.
Search has explicit team/project scope, a five-hit cap and one transient latest
selection; read accepts only its selected asset ID and exact snapshot/revision.
Results use `newmoney-team-knowledge` untrusted JSON details plus deterministic text,
preserving canonical document fields rather than fabricating legacy Experience/SOP.
History admission validates persisted details/text, all branches and exact references,
deduplicates them and re-reads the current authorized same revision before processing.
Read documents must still equal their persisted fields; malformed/unresolved/shared
error results fail closed. Canonical Tool history is never private-capture eligible.

Historical verification uses the distinct private `shared-knowledge-index-read-current`
operation: Main selects its current independently admitted published snapshot but the
requested asset ID and content revision remain mandatory. It retains the same exact
allowlist, receipt replay, head/model checks, limits, close and cancellation semantics;
no Python, query, embedding or replacement revision. Normal selected reads still
require the original search snapshot. Host's Agent-purpose admission remains required.
The macOS arm64 application now selects `canonicalTeamKnowledgeTools` after its
local memory composition and profile initialization succeed. Main overwrites the
inherited `PI67_CANONICAL_TEAM_KNOWLEDGE` value; Host accepts only absent/0/1 and
requires the settings port. Team Tool routing no longer requires private managed
memory: team query settings, receipts and the separately signed query worker have
no dependency on starting the private service. The private service remains off by
default. Other platforms and missing profile composition keep team routing off.
Discovery is not a readiness or authorization grant. Every operation still requires
enabled memory with a non-off privacy mode, checked before credential access,
receipt transport or embedding. Read-only mode does not prohibit authorized reads.
Configuration invalidation still retires in-flight team operations. Each call requires
its existing birth identity, current account/project/model grants, matching local
index and runtime admission. No automatic indexing, model call or fallback is
introduced. Packaged route evidence must verify the actual Pi model-context Tool
identities independently of private activation; signed installation and successful
authorized online/native retrieval remain separate acceptance layers.

Native evidence on 2026-09-13 invalidates direct read-only reopening through the
pinned OV 0.4.16 local collection API: reopening, vector search and close on a
synthetic published generation returned hits but rewrote `collection_meta.json`.
The existing Main artifact checker correctly rejected subsequent reuse. The probe
uses the worker's private umask and does not invoke a model. Do not bypass that
checker or mount a published generation through this ordinary mutable SDK path.
Approved continuation selects a disposable working copy, without patching the SDK.
Main's internal reader now brackets one operation with an exclusive private
`staging/query-*` sibling containing only a byte-verified copy of `index/`, never
hard links, private memory, job bodies or publication metadata. The same bounded
streaming scanner copies bytes and compares the source identity and copy digest.
The reader retains its slot through copy, operation settlement and cleanup; abort
notifies the owner but is not proof that a query process has physically exited.
The operation must await worker and descendant exit before settling on all paths.
Main rechecks receipt/head/authorization/source before execution and result return.
It cleans its exact anchored copy on success/failure/cancellation, refuses deletion
of replaced directories, and does not garbage-collect crash remnants automatically.
The vector primitive now reuses the macOS process-group supervisor. Inherited FD3
carries one bounded vector plus Main-owned asset allowlist, then IDs/scores and an
ACK; no prompt, credential, result body or vector file is written. The fixed SDK
stores encoded `/resources/<assetId>.md` paths and automatic directory records.
Filter current asset IDs AND `account_id=team-<scopeKey>` before top-k, and verify
both fields again on results; a generic nonempty vector search is not asset proof.
Main attaches the exact current receipt revision and revalidates after runtime
admission, operation completion and cleanup. It never invokes a model here.
Physical-exit uncertainty retains the copy AND reader capacity, retires the lease
and quarantines further native vector launches for this Main process; do not
delete, retry or claim process termination on an unconfirmed cleanup error.
Synthetic native tests cover exact asset/version lookup, intact source, successful
group exit and cancellation after real spawn followed by group-absence checks.
The query bootstrap has separate managed revision admission; an actual signed query
installation still needs authorized preparation/delivery. Existing index-v1 trees stay unchanged;
there is no source/private/index-bootstrap fallback in product wiring. Complete
product query wiring, search IPC, disk quotas,
crash recovery and packaged acceptance remain pending. One small native fixture
is not representative performance evidence. Hosted search remains unchanged.

Retire old receipt handles on identity changes; late writes may finish only in
their old namespace and must not acknowledge success to the retired handle.
Keep credentials in platform secure storage and directories user-only. Do not
claim application-level encryption or remote erasure of downloaded plaintext.
An explicit Electron `--user-data-dir` isolates memory under that profile's
`openviking/` too; it must not read, adopt or overwrite canonical memory. Without
that switch the normal New Money layout stays unchanged. This supports synthetic
packaged tests without an environment-only bypass or migration of real data.

## Access and models

Team index failure diagnostics expose only fixed native exit stages through the
Main/Host lifecycle receipt, never raw exceptions or provider/document payloads.
Unknown/legacy worker exits remain worker-exit. A stage labels the failed boundary,
not its exact cause; partial files never imply readiness. Signed runtime updates
remain separately authorized; source diagnostics do not alter installed bundles.

Native index execution has one non-renewable 240-second monotonic job budget.
Each document's vector-queue wait uses only that budget's remaining time; it does
not start a fresh job budget or impose an unrelated 30-second queue cutoff. Native
model-channel requests retain their 30-second limit, and Host/Main authorization
deadlines remain unchanged. Exhaustion, cancellation or incomplete vectors still
withhold the success receipt and prevent publication. Multiple individually valid
authorized model calls must not be mistaken for one timed-out model request.

Shared assets have team or project scope. All active members read team knowledge;
project knowledge additionally requires project membership. Owner/admin manage
membership and review publication; project content still requires membership.
Self-grants are explicit and audited. Members submit candidates; viewers read.
New sessions bind immutable team/project provenance; rebind creates a new session.
Existing Pi Experience/SOP tools now recheck their captured active manager, Session
ID, birth identity and request model before returning asynchronous results. Invalidated
bindings discard transient search selections, including same-ID manager replacement.
This is a completion fence alongside the existing model/Tool lease, not authorization
for canonical document consumption or a new Session persistence mechanism.

Users configure and pay for Agent, extraction and embedding models. Local storage
does not imply local model processing. Team owner/admin maintain an allowed
endpoint/model policy checked before all team-derived model requests. An empty
policy disables team model processing, not web governance. No silent fallback.
Embedding model/dimension changes require a separate rebuilt index and atomic swap.

Host now has an internal `teamKnowledge.embed` phase. It captures a bounded nonempty
query (8 KiB UTF-8, no lossy surrogate conversion) and the expected index embedding
endpoint/model/dimension, then uses the existing encrypted-settings parent client
under credential/configuration/power/Host cancellation. It loads only embedding
credentials, never resolves or calls extraction or private OpenViking. Each request
freshly authorizes the exact team/project and embedding purpose, with no team-scope
fallback or cached grant. The configured model must match the captured index before
any paid request. A success is exactly one index-0 finite float32-range vector of the
configured dimension and an exact matching response model; incompatible provider
responses are rejected, not normalized, truncated or retried. The 60-second query
deadline is further bounded by credential and model-grant expiry. Four Host slots
remain occupied until underlying loading/transport settles after cancellation;
remote provider termination is not guaranteed. This phase is not index read authority,
session provenance admission or a product search command. The complete internal
metadata transaction above obtains the current index model from Main, which verifies
scope/receipt/head at query time and before returning hits. Subsequent body use still
requires its own authorization. No text/vector persistence or implicit query
trigger is added. Synthetic Host/HTTP tests are not real-provider or packaged proof.

## Conversation provenance

Team sessions may read private memory but never automatically write private
long-term memory. Shared summaries, tool results, responses, compaction and forks
retain source scope and asset revisions. A private session must start a new team
session before admitting shared content. Team sessions cannot be reclassified as
private. Candidate submission previews redacted content; full sessions are never
implicitly uploaded. SOPs do not grant Tool authority or install executable Skills.

On membership loss, logout, asset revocation or expired authorization, affected
history remains locally readable but cannot continue, fork, extract memory or be
replayed to a model. New private work starts empty. Restored permission alone does
not restore a revoked asset. Existing copies/exports cannot be remotely recalled.
Permission checks must cover automatic capture/recall and all manual entrypoints.

## Synchronization contract

PostgreSQL stores stable asset IDs, immutable versions, active pointers and audit.
contentRevision is SHA-256 of canonical content, not an ordering counter. Composite
constraints enforce team/project consistency. Candidate submissions are idempotent.

Use separate streams for team-wide and each project's knowledge. Append events,
update the active pointer and audit in one transaction. Lock a stream counter until
commit; an ordinary database sequence cannot establish commit ordering. Each stream
has an epoch and decimal cursor. Retain the entire log in v1; replay from zero.
Rotate epoch after restore/rebuild, requiring fresh local projection.

GET /v1/agent/teams/{teamId}/shared-assets/sync handles team scope;
GET /v1/agent/teams/{teamId}/projects/{projectId}/shared-assets/sync handles project
scope. Return changes, nextCursor, hasMore, headCursor and leaseExpiresAt. Default
50, maximum 100 events and 2 MiB response. Bound publication size so one event fits.
Retain POST shared-assets/search for explicit PostgreSQL keyword management search;
retire only its legacy semantic lane alongside the tested Desktop consumer cutover.
GET shared-assets remains the permission-filtered compatibility metadata list.
Canonical local Experience/SOP consumption uses viking_team_search/read. Legacy
viking_shared_search/read remains a compatibility interface, not a canonical fallback.

Persist received events before advancing the receipt cursor; index progress is
separate. Retry idempotently by version. Block old content immediately on upsert or
revoke; expose new content only after indexing. First sync becomes searchable after
reaching the captured head and completing indexing. Validate returned asset IDs,
versions and scope against the active allowlist; path prefixes alone are not ACLs.
Derived directory summaries must never mix scope boundaries.
The private Host/Main index handoff uses a current Main-issued receipt handle and
one-shot preparation ID, never caller-supplied paths or identity/grants. Registering
a worker is not successful indexing: Main must observe physical completion and
validate the output before reporting `verified-unpublished`. This intermediate state
is not searchable, and receipt synchronization alone never requests paid indexing.
Main also checks the produced index tree and binds its content fingerprint and
later-use revalidation to the captured snapshot/model selection. File identity and
byte checks do not establish database semantics, durability or immutable storage;
publication still requires its own current authorization/head and atomic switch.

Authorization includes permitted scopes, permission revision and model policy.
Lease duration is five minutes; refresh every minute while active and revalidate
after restart/wake/account switch. Never renew a stale projection beyond unprocessed
changes. Explicit denial immediately blocks and cancels team work. Network failure
allows only the existing lease, then blocks team work; private Agent remains usable.

## Runtime and rollout

Desktop requires macOS 14+ on Apple Silicon, as explicitly approved on 2026-09-08;
this applies to the whole application, not only Memory. Windows remains x64.
The macOS baseline matches the pinned OpenViking native wheel requirement;
testing on newer macOS does not substitute for minimum-OS validation.

Main owns managed sidecar lifecycle; Agent Host owns clients/tools; Renderer uses
validated messages only. Bind authenticated random loopback, lazy start, no system
service. Signed manifest plus SHA-256 identifies bundles. Keep previous runtime;
back up before incompatible data changes. Three crashes in ten minutes stop session
restarts. Use bounded background indexing and cancellation. External mode is explicit
development compatibility, not the consumer installation path.

The explicit `private-lazy-litellm-v1` preparation mode applies the pinned build-side
lazy-import recipe before tree measurement. Its embedded patch receipt is part of
the signed tree, not a new trust authority. Generated Python launchers and wheel
RECORD entries must remain relocation-safe and internally consistent. Preparation
and ephemeral test signatures do not authorize production signing or replacement;
team preparation defaults and the consumer lazy-start policy remain unchanged.

The separate opt-in `private-query-coalescing-v1` preparation mode includes the
lazy-import recipe and a pinned request-scoped query-embedding patch. A context
candidate-gather operation may share identical text embeddings only for the same
concrete OpenAI-compatible embedder, account/user/actor/role, model configuration
and exact input. It must not cache across operations, skip authorization or vector
retrieval, reroute providers, or add retries. Unsupported inputs/providers and
capacity overflow use the original embedding path. Results are independently
copied; cancellation of a waiter does not cancel siblings, and scope exit cancels
outstanding shared work. Source/dependency hashes, wheel RECORD changes and the
helper hash are captured before measuring the new tree. This opt-in build recipe
is not activation in the installed runtime. Signing, installation and packaged
acceptance remain separate; synthetic vector tests do not certify semantic quality.

First prove native macOS packaging and real isolation with synthetic data; validate
Windows on actual Windows before claiming support. Record cold-start, query latency,
index time, memory, disk and model usage on mixed Chinese/English fixtures. Do not
substitute metadata, Docker or mocks for native packaged proof.

Keep one execution plan in docs/plans/2026-09-08-new-money-server-extraction.md.
Remove DataHub active implementation only after the replacement works; preserve
historical migrations and production tables. VPS provisioning/deployment, push,
publication and production data removal retain their separate authorization.
