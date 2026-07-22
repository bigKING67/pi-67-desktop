# Performance budgets

Artifact budgets are enforced by `eng/performance/check-artifact-budget.mjs`.
Runtime budgets require a controlled Windows x64 machine and are not inferred
from source or macOS builds.

## Alpha budgets

| Metric | Budget | Evidence |
| --- | ---: | --- |
| Framework-dependent app payload | <= 120 MiB | CI artifact scan |
| App payload file count | <= 500 | CI artifact scan |
| Node control bridge | <= 2 MiB | CI artifact scan |
| Desktop safety extension | <= 1 MiB | CI artifact scan |
| Cold launch to responsive shell, p95 | <= 2.5 s | 10 controlled launches |
| Warm launch to responsive shell, p95 | <= 1.5 s | 10 controlled launches |
| Idle private working set after 60 s, p95 | <= 180 MiB | Process measurement |
| 1,000-message session projection, p95 | <= 1.5 s | Fixed JSONL fixture |
| Streaming visual updates | <= 20 per second | 50 ms coalescing trace |
| Composer input response, p95 | <= 100 ms | UI Automation + ETW |
| Graceful close before forced fallback | <= 5 s | child-process lifecycle trace |

No Rust module is justified until ADR 0006's measured gate is met.
