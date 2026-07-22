# Unsigned alpha release procedure

An unsigned alpha is for controlled testing only. It is not a public trust
release.

1. Build an immutable commit on the Windows x64 CI workflow.
2. Require all core, XAML, installed Pi RPC, bridge, packaging, isolation, and
   artifact budget gates to pass.
3. Review `release-manifest.json`, `compatibility.json`,
   `bootstrap-inventory.json`, `pi67-desktop.cdx.json`,
   `provenance.intoto.json`, and `SHA256SUMS`. The release verifier requires a
   flat, exact artifact set and checks every manifest, provenance, and checksum
   digest before upload.
4. Download CI artifacts into a clean VM and run the installer evidence matrix.
5. Only then invoke the manual `release-alpha.yml` workflow for the exact
   reviewed source commit.

The workflow labels the GitHub prerelease and release notes as unsigned. Public
beta promotion is blocked until signing identity, timestamping, downloaded-
artifact verification, and the complete Windows evidence matrix exist.
