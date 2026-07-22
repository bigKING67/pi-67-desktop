# Desktop versioning

`eng/version.json` is the only file edited to declare a Desktop release
identity. It owns:

- `semver`: the independent Desktop semantic version;
- `msiVersion`: the four-component Windows installer and assembly version;
- `releaseTag`: the immutable GitHub release tag, always
  `desktop-v{semver}`.

After changing it, run:

```powershell
npm run version:sync
npm run version:verify
npm test
```

`version:sync` updates checked-in build-system projections for npm, .NET, the
Pi control bridge, compatibility data, WiX output names, and GitHub workflows.
`version:verify` is the CI gate and never edits files. Review every synchronized
file before commit.

`msiVersion` must advance for every installer build that may be installed over
an earlier controlled-test build, including successive prereleases that share
the same SemVer core. Its first three components must continue to match the
SemVer `major.minor.patch` values.

Release outputs are a flat, exact set. `release-manifest.json` hashes and types
the MSI, Burn setup, compatibility data, bootstrap inventory, and SBOM. SLSA
provenance then covers those payloads plus the release manifest, and
`SHA256SUMS` covers every preceding file. `npm run release:verify` rejects
missing, unexpected, nested, duplicated, stale, or version-drifted artifacts.
