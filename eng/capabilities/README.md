# First-party capability freshness

## Native OpenViking feasibility probe

`corepack pnpm run probe:openviking:native <absolute-isolated-python>`
requires OpenViking 0.4.16 installed in an isolated Python 3.12 environment. It
starts a native loopback server with generated credentials, synthetic accounts and
a local vectors-only model stub. It verifies content and vector scope isolation,
restart persistence and physical resource deletion. Each run creates a temporary
directory with a JSON receipt and synthetic data; it stops its own child and stub
in finally and never reads the user profile, Lab or model credentials.

The probe does not install dependencies, prepare a relocatable runtime, sign a
bundle, connect paid models or prove semantic quality, Desktop integration or
Windows behavior. Its caller must supply the pinned runtime. Use the receipt's
explicit platform and unverified fields when reporting. Temporary receipts are
diagnostic output, not committed release artifacts.

`openviking-runtime/requirements.in` and the target hash locks record this probe's
dependency baseline. macOS arm64 upstream wheels require macOS 14+, matching the
user-approved Desktop minimum of macOS 14 (Apple Silicon only). This resolves the
OS baseline decision, not portable-bundle or minimum-OS runtime validation. Resolve
the macOS feasibility lock with `MACOSX_DEPLOYMENT_TARGET=14.0 uv pip compile
eng/capabilities/openviking-runtime/requirements.in --python-version 3.12
--python-platform aarch64-apple-darwin --only-binary :all: --generate-hashes
--output-file eng/capabilities/openviking-runtime/requirements-macos-arm64.txt`.
This is dependency preparation, not a portable signed bundle.

## Relocatable native preparation (development only)

`prepare:openviking:native <absolute-standalone-python> --team-query-v1` explicitly
selects a fresh query-only bootstrap layout, `newmoney-team/query/v1`, before tree
measurement. Omitting the flag retains the existing index bootstrap preparation.
The query selection copies only `team_query_worker.py`, not probes/tests/model
adapters. It still creates a full isolated Python/package copy, uses ephemeral test
signing and runs the existing private-runtime feasibility probe, not a production
query smoke. It never patches an installed index/private tree. Running this command
performs dependency preparation; documenting it does not authorize execution.

The opt-in Main-service integration test runs the real native process through
`LocalMemoryService` and `LocalMemorySupervisor`, rather than mocking spawn:

```bash
PI67_NATIVE_MEMORY_TEST_RUNTIME=/absolute/verified/runtime corepack pnpm exec vitest run apps/desktop/src/local-memory-service.native.test.ts
```

Supply an existing pinned macOS arm64 runtime tree, not an installation root. The
test uses disposable data, a loopback synthetic embedder and in-memory test signing
keys. It verifies rejection before identity creation, coalesced broker startup,
non-admin private access, two simultaneous private profiles using the same runtime,
same-URI content isolation, empty-profile vector-search isolation and cross-process
credential rejection. OpenViking's pinned API-key auth ignores actor headers; the
test requires spoofed headers to retain the key owner's content and non-admin role.
It also verifies independent restart persistence, key rotation, rejection of a
pre-restart key, temporary config cleanup and unchanged runtime content. It never adopts
user data or credentials. The ordinary suite skips this test without the explicit
environment input. Its 240-second budget covers repeated full-tree measurements
and four native launches; it does not change the service's own startup deadlines.
Success proves this Main service/native combination, not the application entrypoint,
platform Keychain, production signing, minimum-OS support or model semantic quality.
Profile separation is not a sandbox against the same OS user reading local files,
nor evidence of hosted team/project revocation or automatic capture provenance.

Default index preparation copies the three production team worker files into
`runtime/newmoney-team/v1/` before measuring the tree. The script and its two model
channel adapters therefore belong to the same signed identity as Python/packages;
tests and probes are excluded. `prepareIndexWorker` fails closed on old bundles
without this complete bootstrap. This change does not rebuild, re-sign, upgrade or
overwrite an existing installation. Index and query use the separate fixed
installation revisions below; production signing/import and activation still
require their own evidence and authorization.
The worker's job/result formats and vectors-only limits are defined in
`docs/architecture/processes-and-protocol.md`; input validation/native test commands
are in `CONTRIBUTING.md`. No successful local result implies permission or publication.

`corepack pnpm run prepare:openviking:native <absolute-standalone-python>` currently
requires standalone CPython 3.12.10 on a real macOS arm64 host. It rejects a venv,
reuses an intact managed output for identical inputs, or copies the interpreter
without adopting its installed packages and installs only
binary dependencies from the macOS hash lock into an isolated generated directory.
The source interpreter and system Python are never modified. It then relocates the
runtime to a path containing spaces and Chinese characters, checks the content
identity, runs the synthetic native probe with Python isolation enabled, and checks
that the probe did not modify the runtime. Data remains in the probe's separate
temporary directory, not the runtime package.

Preparation also assembles a separate `test-installation-*` copy in the fixed
installation layout below, rechecks its tree, and verifies its manifest through
the actual Main reader and verifier using an ephemeral Ed25519 key. It runs the
native probe from that installation and checks the tree again afterward. After both probes and tree checks pass, preparation removes only the additional
test installation runtime, retaining its assembly receipt and the preparation
receipt. Failed probes retain their runtime for diagnosis. Pass
`--keep-test-installation` to retain a successful test runtime explicitly.
The prepared source runtime remains available for subsequent signing; historical
preparations and signed inputs are not automatically pruned. `assembly-receipt.json` records the assembly
result, while the preparation receipt records the subsequent native probe result.
Neither test key is persisted. The generated installation cannot be admitted by
production trust and is not a signed release artifact.

Each new attempt retains `artifacts/openviking-native/preparation-*/receipt.json`.
Managed payloads follow the bounded lifecycle below; receipts are historical
measurement evidence and do not imply that an evicted path still exists. This is not an app clone or a user profile.
The receipt explicitly labels the interpreter as local operator input and the
package as unsigned. Do not admit it through a production downloader or claim
Windows, macOS 14 minimum-host, production signature verification, Desktop integration or
semantic-model quality from a successful preparation probe. Official interpreter
archive provenance and signed runtime admission remain separate release gates.

The probe now exercises the Main-owned `OpenVikingSidecarSupervisor`: starts are
lazy/coalesced, shutdown interrupts startup and closes late handles, and three
failures in ten minutes block further session-local attempts. It does not restart
in the background. The probe now calls the Main-owned `startNativeOpenViking`
macOS adapter, which bounds readiness and cleanup and owns a detached process group.
This is native adapter evidence, not production Main configuration wiring.

The dedicated data root holds a non-secret `profile.json` (version and stable
localProfileId), `embedding.json` (version and model-identity SHA-256),
OpenViking-owned `data/`, and temporary `.run-*` configuration.
Concurrent first loads atomically converge on one identity. Corrupt identity or
orphaned data requires recovery rather than silent identity replacement. Neither
hosted sign-in nor model identity determines the localProfileId. The adapter creates
a private account and returns a scoped user key, never its root key. Root and model
keys are passed only in the child environment; the temporary config contains
OpenViking-supported environment placeholders, not their values. Normal exit and
crash cleanup remove the temporary config without deleting persistent data.
Only the three credential fields permit environment expansion; dollar signs in
paths, model names and endpoints remain literal. The native probe tests literal
model names and keys containing quotes/backslashes against its synthetic model server.
The production transport gate scans `.mts` as well as `.ts`, with a single
Main-adapter exception for an immediately released random loopback reservation;
business listeners and WebSockets remain forbidden.

The managed service binds the index before native launch to the explicitly selected
embedding protocol, canonical endpoint, model and dimension. API keys are neither
hashed into that binding nor persisted there, so rotation keeps the same index.
The binding is atomically created without overwriting a competing initializer.
Changes require a separate index rebuild; existing unbound data and corrupt markers
require explicit recovery. The rebuild/swap workflow is not implemented yet.
The native probe verifies incompatible changes are blocked and original data stays
readable after restarting with the original configuration; it never adopts the Lab.

This adapter currently accepts explicit OpenAI-compatible extraction/embedding
configuration only; it does not translate other protocols or select fallback models.
It refuses Windows until native process-tree containment has been implemented and
verified there. Runtime authenticity must be established by the Main caller before
supplying the interpreter; the probe remains an explicit developer test with synthetic
models. Production configuration/secure-storage activation is pending; the opted-in
Host/Pi consumer is wired through a session-local Pi ResourceLoader EventBus.

`verifyOpenVikingManifest` verifies bounded Ed25519-signed bytes against a caller-owned
trusted public key and the expected platform, versions and freshly measured runtime
tree hash. The preparation tool tests this primitive with disposable in-memory keys;
`signatureVerification: EPHEMERAL_TEST_KEY_ONLY` never means release signing or a
trusted download. No production trust anchor is created or configured by these tests.

On 2026-09-09, explicit operator authorization provisioned the persistent signing
key under `/Users/gaoqian/.config/new-money-signing/` using
`provision-openviking-signing-key.mjs`. This tool refuses any existing target;
never rerun it as a rotation or overwrite operation. The directory is mode 0700
and private/public PEM plus metadata files are 0600. The private PEM is unencrypted
PKCS8, protected by owner-only permissions; no backup or additional encryption has
been established. Never copy the private PEM into source, logs or runtime bundles.
The public SPKI SHA-256 is
`637e17fea62eaca283d4179548edeae0ce144472fea6fbc08adce28bd9cdbb31`.
Main's `openviking-runtime-trust.ts` pins only that public key;
`createInstalledLocalMemory` uses it by default. An explicit Main-owned key override
exists for isolated tests, never a key supplied by a downloaded bundle or Renderer.
Persisted-key challenge signing, verification and tamper rejection passed. This is
not evidence that a native runtime bundle has been signed with this key. Existing
ephemeral test installations remain untrusted by the default anchor. Key backup,
rotation/revocation and distribution are separate operations; provisioning does not
activate memory, upload artifacts or deploy services.


### Bounded local native artifacts

Preparation and signing use `native-artifact-store.mjs`. The policy applies only to
outputs carrying `native-artifact.json`; pre-existing unmarked outputs remain
protected and are never silently adopted or removed. No installed runtime or user
profile belongs to this store.

An explicitly selected historical signed output can join this policy with
`node eng/capabilities/sign-openviking-local-installation.mjs --adopt <absolute-installation> <tree-sha256>`.
This first verifies the full runtime, source-pinned public signature and assembly
receipt without reading a private key. Add `--apply` to write only ownership
metadata outside the signed tree, under the same generator lock. Original creation
order is preserved, so later successful signing can retire the oldest eligible
output of the same purpose. Adoption itself does not delete payloads. Add `.keep`
before adopting an output that must remain a fixed external input or rollback.

- Per generator and purpose, retain at most two successful payloads and one failed
  payload. This is a per-stage limit, not a global byte quota. Receipts/metadata
  remain after payload eviction. The in-progress operation can temporarily need
  one additional payload; a late protection change aborts retirement visibly.
- Preparation identity binds actual standalone interpreter bytes, purpose, retained
  test mode, Node version, capability code/locks, Desktop verifier and protocol
  source. Input revision v2 skips each source root's README, `*.test.*` JS/TS files,
  `.DS_Store` and `__pycache__`, so those maintenance edits do not force a new
  runtime. Production probes, verifier/patch code, locks and unknown files remain
  inputs; this does not skip content verification or make old test evidence new.
  The identity revision requires one new preparation when migrating a v1 cached
  preparation; signed-installation identity and existing signed bytes are unchanged.
  Reuse rehashes the output. Its native probe receipt is the original
  validation evidence, explicitly reported as `VERIFIED_EXISTING`, not a new probe.
- Signing identity binds the measured runtime tree and public trust anchor; private
  keys never enter metadata. Reuse still validates operator key permissions/trust,
  current source identity and the copied manifest/signature/tree.
- The parent `.native-artifacts.lock` serializes both generators. A crash leaves a
  visible lock: confirm the recorded PID is no longer the operation before manual
  lock recovery. No automatic lock stealing or competing generator is allowed.
- A `.keep` file in a managed output pins its payload; `--keep-test-installation`
  also pins the prepared output. Pin a path before using it as a persistent external
  input. Remove the pin only when that consumer no longer needs the exact path.
  Active process arguments/open files also protect outputs. If protected capacity
  prevents the next operation's safe success/failure outcome, fail before copying.
- Successful preparation removes the disposable test runtime by default. Failed
  builds retain only the latest unprotected failed payload; fixed generated payload
  paths are reclaimed and symlinks/changed targets fail closed.
- Reports distinguish created/reused/retired and retained counts. Legacy/pinned
  artifacts remain explicit exceptions; moving a directory outside the managed
  boundary is not reclamation and does not make total disk use bounded.

New native payloads inside this checkout also use the repository storage budget:
8 decimal GB warning / 10 GB strong warning, with 1.5 GB preparation or 1 GB
signing headroom estimates. Both warnings are advisory: new builds and successful
results remain allowed. The shared large-build lock serializes them with Desktop
packaging. Verified cache reuse skips the new-payload estimate. Warnings do not
delete payloads or suppress build failures; pins, active-use protection and
count-based retention still apply. Explicit signing output outside this checkout is not
covered. See [repository storage budget](../../docs/release/internal-candidate-distribution.md#repository-storage-budget)
for accounting, pre/post-build warnings and the read-only `storage:check` command.

### Native SDK footprint

Fresh macOS preparations apply `prune-openviking-sdk.mjs` after hash-locked wheel
installation and before measuring the runtime. For the reviewed
`volcengine-python-sdk==5.0.48`, retain `volcenginesdkarkruntime`,
`volcenginesdkark` (required by the runtime's credential path) and
`volcenginesdkcore`. Remove only the other 135 service modules from the exact
reviewed wheel catalog. Validate every SDK file against wheel RECORD before
deletion, retain distribution/license metadata, and update RECORD/top-level
metadata to describe the adapted installation. Changed catalog, version, payload,
symlink or owner state fails preparation; installed/signed runtime paths are rejected.

The transformation is part of the preparation cache key and its receipt records
removed bytes/files. Every fresh preparation must pass the isolated Ark synchronous/
asynchronous chat/embedding and denial probe plus the existing two native storage,
search, isolation and restart probes. Real provider quality and signed packaged
acceptance remain separate. Never prune an existing signed tree in place.

### User impact and local signing

Runtime signatures are an automatic authenticity check, not user credentials,
memory encryption, Apple Developer ID/notarization or Windows Authenticode.
Users do not create or receive the private signing key, enter a signing password,
or sign in to verify a runtime. The public key ships with Desktop; verification
is local. Rejected bundles must not launch; no automatic trust bypass is allowed.
This adds tree-verification I/O before launch, not model-token usage. It does not
remove OS unsigned-app warnings, prove the code is bug-free, or protect against
an attacker who can replace Desktop itself. Private-key loss prevents signing
future bundles for the existing anchor, not verification of existing bundles;
compromise requires an explicitly planned trust rotation and distribution.

`sign-openviking-local-installation.mjs <source-runtime> <expected-tree-sha256>
<output-parent> <private-key-path>` is an explicit macOS arm64 local operation.
It checks an owner-private bounded non-symlink key, matches it to the source-pinned
public anchor, verifies the previously recorded source tree, and reuses an intact
managed installation with the same tree and trust anchor. Reuse rechecks the tree,
manifest digest and signature. A cache miss makes a fresh `signed-local-installation-*`
copy, signs the fixed manifest and reads/verifies it
through Main's installed-runtime reader. It never overwrites an existing package,
copies the private key or activates memory. The latest managed failed payload is
retained for diagnosis; older unprotected failures are reclaimed.
The receipt separates signature verification from upstream interpreter provenance,
native launch and production release. Signing alone does not promote a locally
provided interpreter to a verified upstream binary or a release-ready artifact.

`LocalMemoryService` composes that verifier with the shared `runtimeTreeIdentity`,
stable profile store and native supervisor. It satisfies the Main broker service
port and returns only a copied private connection. It remeasures the tree before
each native launch; there is no persistent admission cache. Startup cancellation
covers configuration, hashing, readiness and scope provisioning (60 seconds, with
a 70-second Host reply deadline). The installed runtime must remain owner-controlled;
hashing is not a sandbox against concurrent tampering by the same OS user. Main
runtime delivery, model setup and default consumer activation remain pending.

Main now composes the service after app readiness using its existing
`DesktopSafeStorage` and private Host model client. On macOS arm64 the fixed root is
`app.getPath("appData")/New Money/openviking`, with the selected installation under
`runtime/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64`. Construction does
not create/read storage, invoke secure storage or launch the sidecar. Missing model
settings fail before runtime/model resolution; a missing installation does not
fall back to Lab, artifacts or another executable. Windows remains unbound until
its native containment is verified. The Host managed flag remains off: wiring the
service is not authorization to adopt a diagnostic package or enable memory.

Team preparation and its pre-launch re-admission select the separate fixed child
`runtime/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64-team-index-v1`
under the same normal or explicitly isolated profile root. A missing/invalid team
installation never falls back to the private package or development artifacts.
The private service keeps its original path and settings; production composition
always supplies both roots, while lower-level explicit fixture compositions may
retain the single-root default. Neither construction nor receipt synchronization
installs a runtime or starts an index/model job.

Query runtime admission uses a third fixed `-team-query-v1` child and does not
fall back to either of those roots. `teamQuery.prepareRuntime` freshly verifies
the signed tree, fixed `newmoney-team/query/v1/team_query_worker.py` and canonical
root separation, then re-verifies and compares runtime identity before launch.
It creates no profile/run, resolves no model and starts no process. Actual signing,
installation, Host query embedding and product search activation remain separate.
The local import command below accepts `--team-query-v1` instead of `--team-index-v1`
for this third target; both source and copy must contain the admitted query bootstrap.
All three full installations cost disk space; no disk/performance claim is implied.

The operator-only parallel import command is:

```sh
corepack pnpm run memory:runtime:install-local <signed-installation-directory> <existing-runtime-parent> --team-index-v1
```

Both directory arguments must be absolute, owner-controlled and non-overlapping;
the parent must already exist. This command writes the selected target and requires
authorization for those exact installation paths. Omitting the flag retains the
private target. Each target has a separate exclusive lock and rejects an existing
installation. The source and staged copy must pass signature/tree admission; a team
target additionally requires all three fixed `newmoney-team/v1` bootstrap files.
An old private bundle cannot become team-capable just by renaming it. Failure or
cancellation removes only this transaction's staging/lock, not prior installations.
Crash leftovers require exact-path inspection, not automatic lock recovery. Both
full copies can coexist at additional disk cost; no hardlink sharing, disk-size or
startup-performance guarantee is implied. Import never activates a service or reads
model/signing secrets. The existing settings runtime status/import UI still targets
private memory; team UI activation and production signing/distribution/installation
remain separate work.

Model settings now have a Main/Preload get/save surface and a local form under
Memory settings. Ordinary snapshots never return a saved API key. An explicit
eye action can request the saved embedding key for the matching endpoint. Main
rechecks the trusted document before returning; the form clears saved-key display
references on hide, window blur, document hiding and unmount and ignores late
results. This does not expose the runtime-signing private key or extraction key.
Saves explicitly choose
`keep` or `replace`; keep requires existing settings with the exact same embedding
protocol/endpoint. Endpoint changes cannot silently reuse the old destination's key.
Only the current trusted main frame is admitted; requests are bounded, snapshots
are validated and IPC errors are sanitized. Saving writes encrypted configuration
only, without connectivity probes, model fees, memory activation or hot restart.
Existing incompatible embedding indices remain blocked by the startup binding.

Tree verification now streams at most eight files concurrently, with ordered
digest folding and a drain before descending into directories or emitting links.
It retains all original content/mode/change checks and closes active handles before
returning a failure/cancellation. There is no cache or verification bypass. A local
10-sample comparison on Apple M4 Pro / Darwin 24.6.0 over the same 54,345-file,
641,306,289-byte signed tree measured serial p50/p95 5760/8703 ms and bounded-eight
p50/p95 3091/3238 ms. All 20 tree identities matched the existing signed manifest.
These are sequential local filesystem batches with OS caches, not interleaved,
packaged cold-start, minimum-OS or Windows benchmarks. The first serial sample was
slower (8703 ms); even excluding it the serial median was 5760 ms. Do not promise
these timings on end-user machines or equate hashing time to complete service startup.

The Main settings store writes `models.enc.json` in a caller-owned dedicated
settings directory using the existing `DesktopTextEncryption` adapter. Extraction
retains only a Pi Provider/Model reference; embedding has explicit job parameters
and an encrypted key, not a fake entry in the Pi chat model catalog. The composed
configuration loader obtains fresh extraction credentials through the private Host
client, while runtime paths/manifests remain a separate Main-owned input. A settings
save does not hot-swap the running sidecar. Tests use authenticated synthetic
encryption and isolated files; they are not real Keychain or packaged UI evidence.

The installed-runtime reader uses this fixed layout:

```text
<Main-selected installation>/
  manifest.json       # bounded signed bytes, max 8192 bytes
  manifest.sig        # raw Ed25519 signature, exactly 64 bytes
  runtime/            # only this tree contributes to treeSha256
```

`createInstalledLocalMemory` assembles this reader with the encrypted settings,
private model client and lifecycle service. It requires a separate Main-owned
trusted public key; there is no self-trusted key file or generated default key.
Read operations never mutate an installed bundle. Metadata symlinks, oversized
files and POSIX group/other-writable installation directories are rejected. Memory
state and installed runtime paths are checked for overlap, including canonical
aliases at load time. Older preparation receipts describe only an unsigned
relocatable runtime tree; the new `testInstallation` field identifies the separate
test-only assembled layout, without asserting production trust.

Pi-67 Desktop bundles first-party capabilities from exact Git commits declared
in `capability-sources.lock.json`. Runtime startup and ordinary builds never
follow upstream branches or download a newer capability version implicitly.
The Pi Workspace Resources entry also owns an explicit `includedExtensions` allowlist with
bounded user-facing names and descriptions. A new or retired upstream Extension
cannot silently enter the Desktop baseline, and its presentation metadata stays
content-bound to the prepared capability catalog.

The same lock also records Desktop-release-managed Skill Pack inputs. AI Berkshire
pins one exact upstream commit plus its expected Desktop Pack version, source-manifest
hash, bundle hash, and ordered member hashes. `prepare:capabilities` seeds the full
Desktop baseline from that lock and regenerates the Pack with the adapter
from the Desktop-owned adapter and overlays only the verified Pack members onto
Pi Workspace Resources. It never advances the tracked branch implicitly and fails if
the generated provenance differs from the lock.

## Tracked source policy

Each source remains pinned to an immutable `commit`. A first-party source may
also declare a canonical branch `ref` when Desktop intentionally carries
reviewed post-tag fixes from that branch. The freshness audit then requires the
remote ref to resolve to the exact locked commit. `pi-workspace-resources` and `browser67`
track `refs/heads/main`; this keeps candidate preparation current without ever
making runtime startup, an ordinary build, or an installed Desktop follow a
floating branch.

Sources without `ref` use the stable release policy below.

## Stable release policy

The freshness audit treats the highest `vMAJOR.MINOR.PATCH` or
`MAJOR.MINOR.PATCH` Git tag as the latest stable release. Prerelease tags and an
untagged default-branch `HEAD` do not make a Desktop capability stale.

Branch-owned first-party and Skill Pack sources use the same exact-ref rule: the
audit reads only the declared ref and requires its current commit to equal the
exact locked commit. The ordinary build still consumes only the lock; network
freshness remains confined to scheduled/manual audits, candidate provenance, and
the release gate.

Run the live audit with:

```bash
corepack pnpm run check:capability-freshness
```

The command writes a bounded report to:

```text
artifacts/quality/capability-freshness.json
```

It exits non-zero when a source is stale, ahead of the latest stable tag, or
unreachable. A capability may intentionally pin a reviewed post-tag commit while
retaining the current stable package version. The audit also fails when a tracked
Skill Pack ref has advanced beyond its locked commit. Network freshness is
intentionally excluded from the ordinary `check` and `build` commands so offline
and reproducible builds remain valid.

## Enforcement

- `.github/workflows/capability-freshness.yml` runs the audit every Monday and
  supports manual `workflow_dispatch` execution.
- `.github/workflows/windows-candidate.yml` and `.github/workflows/release.yml`
  run the same audit before a candidate or signed release can proceed.
- Every workflow uploads the JSON report even when the audit fails.

## Updating a stale source

1. For a branch-tracked source, verify the canonical remote `ref`, review the
   exact old-to-new commit diff, and record the resolved commit. For a stable
   source, verify the upstream stable tag, release commit, and declared version.
2. Update `commit` and, when the package version changed, `version` in
   `capability-sources.lock.json`.
3. Increment `catalogVersion` and update the Renderer capability fixture.
4. Run `prepare:capabilities`; every bundled Skill must still have exactly one
   suite membership.
5. Run the freshness audit, targeted tests, typecheck, lint, build, and packaged
   Electron smoke before shipping the next Desktop release. For browser67,
   also run `package:smoke:browser67-live` against a connected local Hub and
   extension; it proves the exact packaged private Node can initialize, list,
   and call both managed MCP servers from an isolated Pi Agent Profile.

`verify:capability-source-lock` shallow-fetches every exact locked commit from
its canonical repository. Candidate and release provenance run this check before
packaging so a local sibling repository or cache cannot hide an unpublished SHA.

## Updating a stale Skill Pack

1. Check out the exact upstream commit from the declared tracked ref without running
   upstream code.
2. Use the Desktop-owned sync adapter to generate the Pack from the prior lock
   baseline.
3. Review Skill membership and tool changes, then update the Pack `commit`, `version`,
   `manifestSha256`, `bundleSha256`, and ordered member `skills` hashes in
   `capability-sources.lock.json`. The complete Desktop lock, not a local generated
   cache, is the prior baseline for the next update.
4. Increment `catalogVersion`; never change the Pi Workspace Resources version merely because a
   carried Skill Pack changed.
5. Run `prepare:capabilities`, freshness, targeted tests, the full quality gate, and
   packaged Electron smoke. Runtime startup must never clone or pull the upstream.

## Desktop-release-managed AI Berkshire baseline

The immutable Desktop baseline remains inside the prepared
`pi-workspace-resources` Package. Runtime never fetches AI Berkshire or a standalone
manager repository. Updating the suite is a release-time operation: pin one exact
upstream commit, regenerate through the Desktop-owned adapter, verify every member
and aggregate hash, increment the capability catalog, and ship the resulting bytes
through the normal Desktop capability transaction. A valid Overlay left by an older
release remains migration-compatible and may be restored to the bundled baseline,
but no new runtime Overlay can be installed.
