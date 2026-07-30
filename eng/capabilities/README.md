# First-party capability freshness

Pi-67 Desktop bundles first-party capabilities from exact Git commits declared
in `capability-sources.lock.json`. Runtime startup and ordinary builds never
follow upstream branches or download a newer capability version implicitly.

## Stable release policy

The freshness audit treats the highest `vMAJOR.MINOR.PATCH` or
`MAJOR.MINOR.PATCH` Git tag as the latest stable release. Prerelease tags and an
untagged default-branch `HEAD` do not make a Desktop capability stale.

Run the live audit with:

```bash
corepack pnpm run check:capability-freshness
```

The command writes a bounded report to:

```text
artifacts/quality/capability-freshness.json
```

It exits non-zero when a source is stale, ahead of the latest stable tag, or
unreachable. Network freshness is intentionally excluded from the ordinary
`check` and `build` commands so offline and reproducible builds remain valid.

## Enforcement

- `.github/workflows/capability-freshness.yml` runs the audit every Monday and
  supports manual `workflow_dispatch` execution.
- `.github/workflows/release.yml` runs the same audit before a signed release can
  proceed.
- Both workflows upload the JSON report even when the audit fails.

## Updating a stale source

1. Verify the upstream stable tag, release commit, and the version declared by
   the source repository.
2. Update `version` and `commit` in `capability-sources.lock.json`.
3. Increment `catalogVersion` and update the Renderer capability fixture.
4. Run `prepare:capabilities`; every bundled Skill must still have exactly one
   suite membership.
5. Run the freshness audit, targeted tests, typecheck, lint, build, and packaged
   Electron smoke before shipping the next Desktop release.
