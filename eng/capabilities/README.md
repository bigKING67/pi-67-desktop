# First-party capability freshness

Pi-67 Desktop bundles first-party capabilities from exact Git commits declared
in `capability-sources.lock.json`. Runtime startup and ordinary builds never
follow upstream branches or download a newer capability version implicitly.
The Pi-67 Core entry also owns an explicit `includedExtensions` allowlist with
bounded user-facing names and descriptions. A new or retired upstream Extension
cannot silently enter the Desktop baseline, and its presentation metadata stays
content-bound to the prepared capability catalog.

The same lock also records Desktop-release-managed Skill Pack inputs. AI Berkshire
pins one exact upstream commit plus its expected Pi-67 Pack version, source-manifest
hash, bundle hash, and ordered member hashes. `prepare:capabilities` seeds the full
Desktop baseline from that lock and regenerates the Pack with the adapter
from the locked Pi-67 Core source and overlays only the verified Pack members onto
the Core capability. It never advances the tracked branch implicitly and fails if
the generated provenance differs from the lock.

## Tracked source policy

Each source remains pinned to an immutable `commit`. A first-party source may
also declare a canonical branch `ref` when Desktop intentionally carries
reviewed post-tag fixes from that branch. The freshness audit then requires the
remote ref to resolve to the exact locked commit. `pi67-core` and `browser67`
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
2. Use the sync adapter from the locked Pi-67 Core source to generate the Pack from
   the prior registry/lock baseline.
3. Review Skill membership and tool changes, then update the Pack `commit`, `version`,
   `manifestSha256`, `bundleSha256`, and ordered member `skills` hashes in
   `capability-sources.lock.json`. The complete Desktop lock, not a local generated
   cache, is the prior baseline for the next update.
4. Increment `catalogVersion`; never change the Pi-67 Core version merely because a
   carried Skill Pack changed.
5. Run `prepare:capabilities`, freshness, targeted tests, the full quality gate, and
   packaged Electron smoke. Runtime startup must never clone or pull the upstream.

## Runtime-managed AI Berkshire Overlay

The immutable Desktop baseline remains inside the prepared `pi67-core` Package.
The user-initiated runtime channel does not fetch AI Berkshire directly and does
not run repository scripts. It resolves `refs/heads/main` from the official Pi-67
repository, binds the check to that exact commit, reads the bounded registry and
lock from the same commit, and accepts only a non-downgrading release whose member
and bundle hashes validate.

Installation shallow-fetches that exact Pi-67 commit into managed staging, copies
only `shared-skills/<declared-member>`, verifies every copied Skill again, and builds
a separate Pi Package under the agent directory. The Overlay Package precedes the
bundled `pi67-core` Package so Pi's first-winner Skill resolution selects it without
modifying packaged resources or user/project Skill directories. Activation and
restore use atomic directory swaps; all Workspace resources reload before the old
state is committed, and reload failure restores the previous Overlay or bundled
baseline. Ordinary startup only validates and reuses an already activated Overlay;
it never performs a network check.
