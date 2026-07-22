# ADR 0006: Rust adoption gate

- Status: Accepted
- Date: 2026-07-22

## Decision

C# owns every production module in v0.1. Rust may be introduced only as a
narrow native library after all of these conditions are met:

1. A repeatable Windows profiler trace identifies a CPU or allocation hotspot
   owned by Desktop rather than upstream Pi, Windows App SDK, or disk/network
   latency.
2. The hotspot exceeds a release budget by at least 20 percent in three or more
   controlled runs.
3. A C# algorithm, allocation, batching, or I/O fix has been attempted and its
   measurements recorded.
4. A Rust prototype improves the failing metric by at least 30 percent without
   regressing startup, package size, crash recovery, diagnostics, or build time
   beyond their budgets.
5. The FFI surface is bounded, memory ownership is explicit, binaries are
   signed with the application, and C# has a truthful failure path.
6. Architecture tests and release scripts reject unreviewed Rust artifacts.

## Rationale

Rust is valuable for proven native hot paths, not as a substitute for profiling
or for a Windows UI framework. Adding it speculatively would increase FFI,
toolchain, signing, debugging, and contributor costs without a measured user
benefit.
