## ADDED Requirements

### Requirement: Desktop has an independent signed release lineage
Desktop source and binaries SHALL be released from `bigKING67/pi-67-desktop`
with independent semantic versions, immutable source provenance, checksums, and
an SBOM.

#### Scenario: Publish an alpha candidate
- **WHEN** an unsigned alpha is prepared for controlled testing
- **THEN** the prerelease includes exact source commit, win-x64 EXE/MSI, SHA-256, compatibility manifest, SBOM, and provenance and does not claim public trust

#### Scenario: Publish a public beta
- **WHEN** the release is promoted to public beta
- **THEN** all executable payloads are timestamp-signed and signature, checksum, installer replay, and downloaded-artifact tests pass

### Requirement: Runtime lifecycles remain independent
Desktop SHALL NOT silently update upstream Pi or pi-67 when Desktop itself is
updated.

#### Scenario: Desktop update is available
- **WHEN** a newer compatible Desktop release exists
- **THEN** the application describes only the Desktop change and requires explicit confirmation before installation

### Requirement: Rust requires measured adoption evidence
The repository MUST NOT add a Rust production module until the documented CPU,
latency or memory threshold and before/after evidence are satisfied.

#### Scenario: Proposed Rust optimization lacks a measured hotspot
- **WHEN** a change proposes Rust based only on theoretical performance
- **THEN** architecture validation rejects the production dependency and directs the change to the C# optimization and measurement path
