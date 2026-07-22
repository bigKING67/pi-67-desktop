# Signing gate

No signing credential is stored in this repository or in local configuration.
The future public beta workflow must:

1. obtain the certificate through an approved CI secret or hardware-backed
   signing service;
2. sign application executables and DLLs before MSI construction;
3. sign the MSI before Burn construction;
4. sign and timestamp the final Burn executable;
5. verify certificate chain, subject, timestamp, digest algorithm, and file
   SHA-256 after downloading the release artifacts;
6. fail closed when any credential, timestamp service, or verification step is
   unavailable.

The current `release-alpha.yml` intentionally publishes unsigned prereleases
only and must not be reused for a public beta.
