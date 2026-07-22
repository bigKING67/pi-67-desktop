# Runtime compatibility matrix

The machine-readable authority is `eng/compatibility/compatibility.json`.

| Component | Minimum | Tested | Policy |
| --- | ---: | ---: | --- |
| Windows 10 | 22H2 / 19045 | Controlled VM pending | x64 only |
| Windows 11 | 22H2 / 22621 | Controlled VM pending | x64 only |
| .NET Desktop | 10.0 | 10.0.10 runtime | Burn prerequisite |
| Windows App SDK | 2.3.1 | 2.3.1 | Burn prerequisite |
| Node.js | 24.x | 24.18.0 | User install, separately confirmed |
| npm | 11.x | 11.16.0 | Reuse compatible install |
| upstream Pi | 0.80.0 | 0.80.6 | Newer versions marked unverified |
| pi-67 | n/a | 0.14.3 | Manager and distro remain independent |

Source compatibility, a successful build, and native runtime evidence are
reported separately. A static macOS cross-build is never Windows UI evidence.
