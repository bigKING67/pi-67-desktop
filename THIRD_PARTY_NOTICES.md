# Third-Party Notices

## Peak Code

Pi-67 Desktop references the product behavior and information architecture of
PeakCode-AI/PeakCode at commit:

```text
5aee9cfcbb29283f9320a132693d4a250033fb9e
```

Peak Code is distributed under the MIT License. No Peak Code source or binary
asset is currently copied into this repository. If code or assets are ported,
the applicable MIT copyright and license text must be added here in the same
change.

## Runtime and build dependencies

- .NET 10 and the Windows App SDK are Microsoft components distributed under
  their respective Microsoft license terms. The Burn bundle uses the exact
  official .NET Desktop Runtime URL and SHA-512 recorded in
  `eng/packaging/bootstrap-inventory.json`.
- WiX Toolset 5.0.2 is used to build MSI and Burn artifacts. WiX 5 is pinned to
  avoid the Open Source Maintenance Fee introduced in WiX 6 and the EULA
  acceptance enforcement added in WiX 7.
- Markdig, CommunityToolkit.Mvvm, Microsoft.Data.Sqlite, SQLitePCLRaw, xUnit,
  NetArchTest, and FlaUI are represented in the generated CycloneDX SBOM.

The generated SBOM is a release artifact, not a checked-in replacement for
this human-readable notice. The application does not redistribute upstream Pi
or Node.js.
